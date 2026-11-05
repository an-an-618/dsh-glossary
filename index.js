/**
 * Glossary — Host half.
 *
 * The Host registers one system-prompt section with the glossary rules. The
 * model answers as usual and appends a trailing `<dsh:glossary>` data block;
 * the Client half hides that block in the rendered transcript, marks the terms
 * in the answer and opens a definition card on click.
 *
 * The rules are a function-text section, so the live `Config` values
 * (`max_terms`, `def_max`, `more_max`, `language`) are read on every prompt
 * assembly: changing a field in the plugin settings applies from the next turn
 * without restarting the Host.
 *
 * `@deepseek-ai/schemastery` cannot be imported as a bare specifier from a
 * profile-linked package (Node resolves the workspace realpath), so the schema
 * library is resolved at runtime from the profile or the installed dsh; when no
 * copy is reachable the plugin simply has no `Config` and keeps its row
 * defaults.
 *
 * No dynamic code and no I/O beyond locating that library.
 *
 * @module @an-an-618/dsh-glossary
 */

import { existsSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

import {
  LANGUAGES,
  SECTION_NAME,
  SECTION_ORDER,
  STRICTNESS,
  buildPromptSection,
  normalizeConfig,
} from './lib/prompt.js'

export const name = 'glossary'

/** Services required by the Host half (resolved by name, no package imports). */
export const inject = ['systemPrompt']

/** Prompt section identity, re-exported for tests and the release preflight. */
export { SECTION_NAME, SECTION_ORDER }

/**
 * Resolve schemastery from the running installation. A linked package lives in
 * the workspace, so a bare import would resolve against the workspace and fail;
 * the installed dsh and the profile both ship the package.
 * @returns {Promise<object | undefined>} the `z` schema factory, or undefined.
 */
async function loadSchemastery() {
  const roots = []
  for (const arg of process.argv.slice(1)) {
    if (typeof arg !== 'string' || arg === '') continue
    if (arg.endsWith('/app.asar/dsh') || arg.includes('/.dsh/profiles/')) roots.push(arg)
  }
  if (typeof process.env.DSH_PROFILE_DIR === 'string' && process.env.DSH_PROFILE_DIR !== '') {
    roots.push(process.env.DSH_PROFILE_DIR)
  }
  const profilesDir = join(homedir(), '.dsh', 'profiles')
  if (existsSync(profilesDir)) {
    try {
      for (const entry of readdirSync(profilesDir)) roots.push(join(profilesDir, entry))
    } catch (error) {
      /* the fallback is optional */
    }
  }
  for (const root of roots) {
    const file = join(root, 'node_modules', '@deepseek-ai', 'schemastery', 'lib', 'index.mjs')
    try {
      if (!existsSync(file)) continue
      const module = await import(pathToFileURL(file).href)
      if (module !== undefined && module.default !== undefined) return module.default
    } catch (error) {
      /* try the next candidate */
    }
  }
  try {
    const module = await import('@deepseek-ai/schemastery')
    return module !== undefined && module.default !== undefined ? module.default : undefined
  } catch (error) {
    return undefined
  }
}

const z = await loadSchemastery()

/**
 * Live plugin settings. Every field is `volatile()`: the settings form commits
 * a value into the running config, and each prompt assembly picks it up.
 */
export const Config = z === undefined ? undefined : z.object({
  enabled: z.boolean()
    .description('总开关：关闭后系统提示不再注入术语解释规则')
    .default(true)
    .volatile(),
  max_terms: z.number().step(1).min(1).max(8)
    .description('每轮最多解释的术语数（1–8）')
    .default(5)
    .volatile(),
  def_max: z.number().step(1).min(20).max(120)
    .description('一句话释义上限（中文字数；英文约四分之一词数）')
    .default(40)
    .volatile(),
  more_max: z.number().step(1).min(40).max(400)
    .description('展开释义上限（中文字数；英文约一半词数）')
    .default(150)
    .volatile(),
  language: z.union(LANGUAGES)
    .description('follow_user = 释义语言跟随用户；zh / en 同时固定规则文本语言')
    .default('follow_user')
    .volatile(),
  strictness: z.union(STRICTNESS)
    .description('触发尺度：relaxed = 宁可多一条（代码场景也照标）；standard = 原规则；strict = 更克制')
    .default('standard')
    .volatile(),
})

/** Plain-object test that also rejects arrays. */
function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Read one config field, following the live reference `volatile()` produces.
 * Plain values are accepted too, which keeps tests and the bundle row simple.
 */
function liveValue(field, fallback) {
  if (field === undefined || field === null) return fallback
  if (typeof field === 'object' && typeof field.get === 'function') {
    const current = field.get()
    return current === undefined ? fallback : current
  }
  return field
}

/**
 * Snapshot the live row configuration into the normalized settings shape.
 * @param {unknown} config
 * @returns {ReturnType<typeof normalizeConfig>}
 */
export function readSettings(config) {
  const source = isRecord(config) ? config : {}
  return normalizeConfig({
    enabled: liveValue(source.enabled, true),
    max_terms: liveValue(source.max_terms, 5),
    def_max: liveValue(source.def_max, 40),
    more_max: liveValue(source.more_max, 150),
    language: liveValue(source.language, 'follow_user'),
    strictness: liveValue(source.strictness, 'standard'),
  })
}

/**
 * Register the prompt section, unless disabled.
 * @param {object} ctx - plugin context with `systemPrompt` and `effect`.
 * @param {object} [config]
 */
export function apply(ctx, config = {}) {
  const initial = readSettings(config)
  if (!initial.enabled) return
  ctx.effect(() => ctx.systemPrompt.section({
    name: SECTION_NAME,
    order: SECTION_ORDER,
    // A function text keeps the switches live: the section is rebuilt for every
    // assembly with the current config values.
    text: () => {
      const settings = readSettings(config)
      return settings.enabled ? buildPromptSection(settings) : ''
    },
  }))
}
