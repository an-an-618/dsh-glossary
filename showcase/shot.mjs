#!/usr/bin/env node
/**
 * Renders the showcase images.
 *
 * Opens showcase/index.html in headless Chrome, waits until the real client.js
 * has decorated all four answers and the real definition cards are mounted,
 * then writes the gallery plus one crop per panel. Afterwards it opens
 * showcase/popover.html to capture the card as a real floating popover in a
 * chat-like column.
 *
 *   showcase/showcase.png       the whole 2x2 gallery
 *   showcase/showcase-1..4.png  one panel each, cropped
 *   showcase/popover.png        the card floating over a real answer
 *
 * Usage: node showcase/shot.mjs
 * Needs Google Chrome (or CHROME=/path/to/chrome).
 */

import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const PORT = 9412
const GALLERY_URL = pathToFileURL(join(root, 'showcase/index.html')).href
const POPOVER_URL = pathToFileURL(join(root, 'showcase/popover.html')).href

if (!existsSync(CHROME)) {
  console.error('Chrome not found; set CHROME=/path/to/chrome')
  process.exit(1)
}

const profile = mkdtempSync(join(tmpdir(), 'dsh-glossary-showcase-'))
const chrome = spawn(CHROME, [
  '--headless=new',
  '--remote-debugging-port=' + String(PORT),
  '--user-data-dir=' + profile,
  '--no-first-run',
  '--no-default-browser-check',
  '--hide-scrollbars',
  '--force-device-scale-factor=2',
  '--window-size=1240,1500',
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
    const result = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails))
    return result.result.value
  }

  async ready() {
    for (let attempt = 0; attempt < 60; attempt++) {
      if (await this.evaluate('window.__READY__ === true')) return
      await sleep(200)
    }
    throw new Error('page never became ready')
  }

  failure() {
    return this.evaluate('window.__ERROR__ || null')
  }

  async shot(path, clip) {
    const params = { format: 'png', captureBeyondViewport: true }
    if (clip) params.clip = clip
    const shot = await this.send('Page.captureScreenshot', params)
    writeFileSync(join(root, path), Buffer.from(shot.data, 'base64'))
    console.log('saved ' + path)
  }
}

/** Open one page target and attach a client to it. */
async function openPage(url) {
  const target = await (await fetch('http://127.0.0.1:' + String(PORT) + '/json/new?' + encodeURIComponent(url), { method: 'PUT' })).json()
  const ws = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true })
    ws.addEventListener('error', reject, { once: true })
  })
  const client = new Client(ws)
  await client.send('Page.enable')
  await client.send('Runtime.enable')
  await client.ready()
  const failure = await client.failure()
  if (failure !== null) throw new Error(failure)
  return { client, ws }
}

const sockets = []
try {
  await waitForPort()

  /* 1. Gallery ------------------------------------------------------------ */
  const gallery = await openPage(GALLERY_URL)
  sockets.push(gallery.ws)
  const stats = JSON.parse(await gallery.client.evaluate(`JSON.stringify({
    panels: document.querySelectorAll('.panel').length,
    marks: document.querySelectorAll('[data-dsh-gl-mark]').length,
    cards: document.querySelectorAll('[data-dsh-gl-card]').length,
    hidden: document.querySelectorAll('.dsh-gl-hidden').length,
    visibleJson: document.body.innerText.indexOf('"forms"') >= 0,
    visibleJson: document.body.innerText.indexOf('"forms"') >= 0,
    hidden: document.querySelectorAll('.dsh-gl-hidden').length
  })`))
  console.log(JSON.stringify(stats))
  if (stats.panels !== 4 || stats.marks < 9 || stats.cards !== 4 || stats.hidden < 4) {
    throw new Error('gallery did not render as expected')
  }
  if (stats.visibleJson || stats.visibleTag) throw new Error('data block leaked into the visible text')

  await sleep(500)
  await gallery.client.shot('showcase/showcase.png')

  const rects = JSON.parse(await gallery.client.evaluate(`JSON.stringify(Array.from(document.querySelectorAll('.panel')).map(function (panel) {
    var r = panel.getBoundingClientRect();
    return { x: r.x + window.scrollX, y: r.y + window.scrollY, width: r.width, height: r.height };
  }))`))
  for (let index = 0; index < rects.length; index++) {
    const rect = rects[index]
    await gallery.client.shot('showcase/showcase-' + String(index + 1) + '.png', {
      x: rect.x - 10,
      y: rect.y - 10,
      width: rect.width + 20,
      height: rect.height + 20,
      scale: 1,
    })
  }

  /* 2. Floating card in a chat column ------------------------------------ */
  const popover = await openPage(POPOVER_URL)
  sockets.push(popover.ws)
  const popoverStats = JSON.parse(await popover.client.evaluate(`JSON.stringify({
    marks: document.querySelectorAll('[data-dsh-gl-mark]').length,
    cards: document.querySelectorAll('[data-dsh-gl-card]').length,
    cardVisible: (function () {
      var card = document.querySelector('[data-dsh-gl-card]');
      return card !== null && getComputedStyle(card).visibility !== 'hidden';
    })(),
    visibleJson: document.body.innerText.indexOf('"forms"') >= 0,
    hidden: document.querySelectorAll('.dsh-gl-hidden').length
  })`))
  console.log(JSON.stringify(popoverStats))
  if (popoverStats.marks !== 3 || popoverStats.cards !== 1 || popoverStats.cardVisible !== true || popoverStats.hidden < 1) {
    throw new Error('popover page did not render as expected')
  }
  if (popoverStats.visibleJson) throw new Error('data block leaked on the popover page')
  await popover.client.send('Emulation.setDeviceMetricsOverride', {
    width: 880,
    height: 640,
    deviceScaleFactor: 2,
    mobile: false,
  })
  await sleep(400)
  const popoverHeight = await popover.client.evaluate(`Math.round((function () {
    var note = document.querySelector('.note');
    var bottom = note === null ? document.body.scrollHeight : note.getBoundingClientRect().bottom;
    return Math.min(document.body.scrollHeight, bottom + 46);
  })())`)
  await popover.client.shot('showcase/popover.png', { x: 0, y: 0, width: 880, height: popoverHeight, scale: 1 })
} catch (error) {
  console.error('ERROR ' + error.message)
  process.exitCode = 1
} finally {
  for (const ws of sockets) {
    try {
      ws.close()
    } catch (error) {
      /* already closed */
    }
  }
  chrome.kill('SIGTERM')
  await sleep(300)
  try {
    rmSync(profile, { recursive: true, force: true })
  } catch (error) {
    /* best effort */
  }
}
