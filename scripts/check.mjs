#!/usr/bin/env node
/**
 * Release preflight for @an-an-618/dsh-glossary.
 *
 * Run before installing the bundle into any profile. It checks the class of
 * failure that broke an earlier plugin install (a double-brace sequence in a
 * system-prompt section makes DSH treat it as a malformed template and fails
 * every turn), plus syntax, both test suites, the manifest, locale resources
 * and source hygiene.
 *
 * Usage: node scripts/check.mjs
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const failures = []

function ok(name) {
  console.log(`ok   ${name}`)
}

function fail(name, detail) {
  failures.push(name)
  console.error(`FAIL ${name}${detail === undefined ? '' : `: ${detail}`}`)
}

function run(name, args) {
  const result = spawnSync(process.execPath, args, { cwd: root, encoding: 'utf8' })
  if (result.status === 0) {
    ok(name)
    return true
  }
  if (result.stdout.trim() !== '') console.error(result.stdout.trim())
  if (result.stderr.trim() !== '') console.error(result.stderr.trim())
  fail(name, `exit ${result.status === null ? result.signal : result.status}`)
  return false
}

function jsFiles(dir) {
  const absolute = join(root, dir)
  if (!existsSync(absolute)) return []
  return readdirSync(absolute)
    .filter((entry) => entry.endsWith('.js') || entry.endsWith('.mjs'))
    .map((entry) => join(dir, entry))
}

/* 1. Syntax ---------------------------------------------------------------- */

const syntaxTargets = ['index.js', 'client.js', ...jsFiles('lib'), ...jsFiles('showcase'), ...jsFiles('scripts'), ...jsFiles('test')]
for (const file of syntaxTargets) {
  if (file === 'scripts/check.mjs' || file.endsWith('.html')) continue
  run(`node --check ${file}`, ['--check', file])
}

/* 2. Tests ----------------------------------------------------------------- */

run('host tests', ['test/host.test.mjs'])
run('client tests', ['test/client.test.mjs'])

/* 3. Prompt template guard ------------------------------------------------- */

const { buildPromptSection, SECTION_NAME, SECTION_ORDER } = await import(pathToFileURL(join(root, 'lib/prompt.js')).href)

for (const language of ['follow_user', 'zh', 'en']) {
  for (const strictness of ['relaxed', 'standard', 'strict']) {
  for (const limits of [{}, { maxTerms: 1, defMax: 20, moreMax: 40 }, { maxTerms: 8, defMax: 120, moreMax: 400 }]) {
    const label = `${language}/${strictness} ${JSON.stringify(limits)}`
    const section = buildPromptSection({ language, strictness, ...limits })
    if (section.includes('{{')) fail(`prompt section (${label})`, 'contains "{{"; DSH will fail every turn')
    else ok(`prompt section (${label}) has no "{{"`)
    if (!section.includes('<dsh:glossary>')) fail(`prompt section (${label})`, 'missing the data-block tag')
    else ok(`prompt section (${label}) documents the tag`)
    if (section.length < 1500) fail(`prompt section (${label})`, `too short: ${section.length}`)
  }
  }
}

if (SECTION_NAME !== 'glossary') fail('section name', SECTION_NAME)
else ok('section name')
if (SECTION_ORDER !== 2450) fail('section order', String(SECTION_ORDER))
else ok('section order')

/* 4. Manifest -------------------------------------------------------------- */

const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
if (manifest.name !== '@an-an-618/dsh-glossary') fail('manifest name', manifest.name)
else ok('manifest name')

for (const [key, target] of Object.entries(manifest.exports ?? {})) {
  if (target.includes('*')) continue
  if (!existsSync(join(root, target))) fail(`export ${key}`, `${target} does not exist`)
  else ok(`export ${key}`)
}
for (const entry of manifest.files ?? []) {
  if (entry.includes('*')) continue
  if (!existsSync(join(root, entry))) fail(`files entry ${entry}`, 'does not exist')
  else ok(`files entry ${entry}`)
}
if (manifest.dsh?.bundle?.patch !== './cordis.patch.yml') fail('dsh.bundle.patch', String(manifest.dsh?.bundle?.patch))
else ok('dsh.bundle.patch')
if (manifest.dsh?.client?.platform !== 'web') fail('dsh.client.platform', String(manifest.dsh?.client?.platform))
else ok('dsh.client.platform')
if (!manifest.dsh?.client?.inject?.includes('@deepseek-ai/dsh-client-ui-chat')) fail('dsh.client.inject', 'missing ui-chat')
else ok('dsh.client.inject')

const patch = readFileSync(join(root, 'cordis.patch.yml'), 'utf8')
if (!patch.includes("name: '@an-an-618/dsh-glossary'")) fail('cordis.patch.yml', 'row name missing')
else ok('cordis.patch.yml row')
if (!patch.includes('id: glossary')) fail('cordis.patch.yml', 'row id missing')
else ok('cordis.patch.yml row id')

/* 5. Locale resources ------------------------------------------------------ */

for (const language of ['zh', 'en']) {
  const file = join(root, 'locale', language + '.json')
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8'))
    const meta = parsed.meta
    if (typeof meta?.title !== 'string' || meta.title.trim() === '') fail(`locale ${language}`, 'meta.title missing')
    else if (typeof meta?.description !== 'string' || meta.description.trim() === '') fail(`locale ${language}`, 'meta.description missing')
    else ok(`locale ${language}`)
  } catch (error) {
    fail(`locale ${language}`, error.message)
  }
}

/* 6. Source hygiene -------------------------------------------------------- */

const hostSources = ['index.js', ...jsFiles('lib')]
const clientSource = readFileSync(join(root, 'client.js'), 'utf8')

for (const file of ['index.js', 'client.js', ...jsFiles('lib')]) {
  const source = readFileSync(join(root, file), 'utf8')
  for (const [pattern, label] of [
    [/\bnew\s+Function\b/, 'new Function'],
    [/\beval\s*\(/, 'eval('],
    [/\bfetch\s*\(/, 'fetch('],
  ]) {
    if (pattern.test(source)) fail(`${file} contains ${label}`, 'source hygiene')
  }
}
ok('no dynamic code or network in runtime sources')

for (const file of hostSources) {
  const source = readFileSync(join(root, file), 'utf8')
  if (/\bdocument\s*\./.test(source)) fail(`${file} touches document`, 'Host half must stay DOM-free')
}
ok('Host half is DOM-free')

for (const marker of ['data-dsh-gl-mark', 'data-dsh-gl-hidden', 'parseGlossaryText', 'shell.overlay', 'plugins.row.config']) {
  if (!clientSource.includes(marker)) fail('client.js markers', `missing ${marker}`)
}
ok('client.js carries the decorator, card and settings entry points')

/* 7. Summary --------------------------------------------------------------- */

if (failures.length > 0) {
  console.error(`\nPREFLIGHT FAILED (${failures.length}): ${failures.join(', ')}`)
  process.exit(1)
}
console.log('\nPREFLIGHT OK: syntax, tests, prompt template, manifest, locale and source hygiene.')
