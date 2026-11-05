#!/usr/bin/env node
/**
 * Real-browser check for the Client decorator.
 *
 * Opens test/fixture.html in a headless Chrome, runs the fixture's own
 * assertions (block hidden, terms marked, click opens the card, restore puts
 * the source back) and writes a screenshot next to the fixture.
 *
 * Usage: node test/browser-check.mjs [--keep-open]
 *
 * Needs Google Chrome (or CHROME=/path/to/chrome). No npm dependency: the
 * DevTools protocol is driven over Node's built-in WebSocket.
 */

import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const PORT = 9411
const URL = pathToFileURL(join(root, 'test/fixture.html')).href

if (!existsSync(CHROME)) {
  console.error('Chrome not found; set CHROME=/path/to/chrome')
  process.exit(1)
}

const profile = mkdtempSync(join(tmpdir(), 'dsh-glossary-chrome-'))
const chrome = spawn(CHROME, [
  '--headless=new',
  '--remote-debugging-port=' + String(PORT),
  '--user-data-dir=' + profile,
  '--no-first-run',
  '--no-default-browser-check',
  '--hide-scrollbars',
  '--window-size=900,1000',
  'about:blank',
], { stdio: 'ignore' })

function sleep(ms) {
  return new Promise((done) => setTimeout(done, ms))
}

async function waitForPort() {
  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      const response = await fetch('http://127.0.0.1:' + String(PORT) + '/json/version')
      if (response.ok) return
    } catch (error) {
      /* not up yet */
    }
    await sleep(200)
  }
  throw new Error('Chrome did not expose the DevTools endpoint')
}

class Client {
  constructor(ws) {
    this.ws = ws
    this.id = 0
    this.pending = new Map()
    ws.addEventListener('message', (event) => {
      const message = JSON.parse(event.data)
      if (message.id === undefined) return
      const entry = this.pending.get(message.id)
      if (entry === undefined) return
      this.pending.delete(message.id)
      if (message.error) entry.reject(new Error(JSON.stringify(message.error)))
      else entry.resolve(message.result)
    })
  }

  send(method, params = {}) {
    const id = ++this.id
    this.ws.send(JSON.stringify({ id, method, params }))
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      setTimeout(() => {
        if (!this.pending.has(id)) return
        this.pending.delete(id)
        reject(new Error('CDP timeout: ' + method))
      }, 20000)
    })
  }

  async evaluate(expression) {
    const result = await this.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    })
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails))
    return result.result.value
  }
}

let ws
try {
  await waitForPort()
  const target = await (await fetch('http://127.0.0.1:' + String(PORT) + '/json/new?' + encodeURIComponent(URL), { method: 'PUT' })).json()
  ws = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true })
    ws.addEventListener('error', reject, { once: true })
  })
  const client = new Client(ws)
  await client.send('Page.enable')
  await client.send('Runtime.enable')
  for (let attempt = 0; attempt < 50; attempt++) {
    if (await client.evaluate('window.__READY__ === true')) break
    await sleep(200)
  }
  // Let the browser paint the decoration before the first capture.
  await sleep(500)
  const shotPath = join(root, 'test/fixture.png')
  const shot = await client.send('Page.captureScreenshot', { format: 'png' })
  writeFileSync(shotPath, Buffer.from(shot.data, 'base64'))
  await client.evaluate('typeof window.__OPEN_CARD__ === "function" ? window.__OPEN_CARD__() : null')
  await sleep(500)
  const cardShot = await client.send('Page.captureScreenshot', { format: 'png' })
  const cardShotPath = join(root, 'test/fixture-card.png')
  writeFileSync(cardShotPath, Buffer.from(cardShot.data, 'base64'))
  await client.evaluate('typeof window.__FINISH__ === "function" ? window.__FINISH__() : null')
  let result = null
  for (let attempt = 0; attempt < 50; attempt++) {
    result = await client.evaluate('window.__RESULT__ || null')
    if (result !== null && result !== undefined) break
    await sleep(200)
  }
  if (result === null || result === undefined) {
    const title = await client.evaluate('document.title + " | " + document.body.innerText.slice(0, 400)')
    throw new Error('fixture did not produce a result: ' + title)
  }
  if (result.ok !== true) {
    console.error('FAIL ' + JSON.stringify(result.failures, null, 2))
    process.exitCode = 1
  } else {
    console.log('ok   ' + String(result.notes.length) + ' browser assertions')
    for (const note of result.notes) console.log('ok   ' + note.replace(/^ok\s+/, ''))
    console.log('saved ' + shotPath)
    console.log('saved ' + cardShotPath)
  }
} catch (error) {
  console.error('ERROR ' + error.message)
  process.exitCode = 1
} finally {
  if (ws !== undefined) ws.close()
  chrome.kill('SIGTERM')
  await sleep(300)
  try {
    rmSync(profile, { recursive: true, force: true })
  } catch (error) {
    /* best effort */
  }
}
