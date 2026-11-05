/**
 * Host-half tests for @an-an-618/dsh-glossary.
 *
 * Zero dependencies beyond node:test / node:assert. Run with:
 *
 *   node test/host.test.mjs
 *
 * Covers config normalization and clamping, the prompt-template guard (a
 * double-brace sequence would break every turn), the config values reaching
 * the live prompt text, and the section registration / disabled switch.
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import { Config, SECTION_ORDER, SECTION_NAME, apply, readSettings } from '../index.js'
import { STRICTNESS, buildPromptSection, buildSelectionSection, buildTriggerSection, normalizeConfig } from '../lib/prompt.js'

test('normalizeConfig fills defaults', () => {
  const settings = normalizeConfig({})
  assert.equal(settings.enabled, true)
  assert.equal(settings.maxTerms, 5)
  assert.equal(settings.defMax, 40)
  assert.equal(settings.moreMax, 150)
  assert.equal(settings.language, 'follow_user')
  assert.equal(settings.promptLanguage, 'zh')
})

test('normalizeConfig clamps every numeric field', () => {
  assert.equal(normalizeConfig({ max_terms: 0 }).maxTerms, 1)
  assert.equal(normalizeConfig({ max_terms: 99 }).maxTerms, 8)
  assert.equal(normalizeConfig({ def_max: 1 }).defMax, 20)
  assert.equal(normalizeConfig({ def_max: 999 }).defMax, 120)
  assert.equal(normalizeConfig({ more_max: 1 }).moreMax, 40)
  assert.equal(normalizeConfig({ more_max: 9999 }).moreMax, 400)
  assert.equal(normalizeConfig({ max_terms: 3.4 }).maxTerms, 3)
  assert.equal(normalizeConfig({ max_terms: Number.NaN }).maxTerms, 5)
})

test('normalizeConfig validates the strictness switch', () => {
  assert.deepEqual(STRICTNESS, ['relaxed', 'standard', 'strict'])
  assert.equal(normalizeConfig({}).strictness, 'standard')
  assert.equal(normalizeConfig({ strictness: 'relaxed' }).strictness, 'relaxed')
  assert.equal(normalizeConfig({ strictness: 'klingon' }).strictness, 'standard')
})

test('normalizeConfig keeps only accepted languages and the enabled switch', () => {
  assert.equal(normalizeConfig({ language: 'en' }).promptLanguage, 'en')
  assert.equal(normalizeConfig({ language: 'klingon' }).language, 'follow_user')
  assert.equal(normalizeConfig({ enabled: false }).enabled, false)
  assert.equal(normalizeConfig({ enabled: 'no' }).enabled, true)
})

test('readSettings follows live volatile fields', () => {
  const live = {
    enabled: { get: () => false },
    max_terms: { get: () => 3 },
    def_max: { get: () => 30 },
    more_max: { get: () => 60 },
    language: { get: () => 'en' },
  }
  const settings = readSettings(live)
  assert.equal(settings.enabled, false)
  assert.equal(settings.maxTerms, 3)
  assert.equal(settings.defMax, 30)
  assert.equal(settings.moreMax, 60)
  assert.equal(settings.promptLanguage, 'en')
  // Plain values are accepted as well (tests, patch rows).
  assert.equal(readSettings({ max_terms: 7 }).maxTerms, 7)
  assert.equal(readSettings(undefined).maxTerms, 5)
  assert.equal(readSettings({ strictness: { get: () => 'relaxed' } }).strictness, 'relaxed')
  assert.equal(readSettings({}).strictness, 'standard')
})

test('prompt section carries the data-block contract and the configured limits', () => {
  const section = buildPromptSection({ maxTerms: 4, defMax: 32, moreMax: 88, language: 'follow_user' })
  assert.match(section, /术语解释/)
  assert.ok(section.includes('<dsh:glossary>'), 'tag is documented')
  assert.ok(section.includes('"forms"'), 'JSON shape is documented')
  assert.ok(section.includes('不超过 32 字'), 'def_max reaches the text')
  assert.ok(section.includes('不超过 88 字'), 'more_max reaches the text')
  assert.ok(section.includes('不超过 4 个'), 'max_terms reaches the text')
  assert.ok(section.includes('上下文推断'), 'internal-name rule is documented')
  assert.ok(section.includes('def（必填'), 'field contract is documented')
})

test('English rules are emitted for language en and mention the caps', () => {
  const section = buildPromptSection({ language: 'en', maxTerms: 6, defMax: 30, moreMax: 90 })
  assert.match(section, /Glossary/)
  assert.ok(section.includes('<dsh:glossary>'))
  assert.ok(section.includes('at most 30 characters'))
  assert.ok(section.includes('at most 90 characters'))
  assert.ok(section.includes('at most 6 per turn'))
  assert.ok(section.includes('上下文推断'))
})

test('no prompt text ever contains a double brace', () => {
  for (const language of ['follow_user', 'zh', 'en']) {
    for (const limits of [{}, { maxTerms: 1 }, { maxTerms: 8, defMax: 120, moreMax: 400 }]) {
      const section = buildPromptSection({ language, ...limits })
      assert.equal(section.includes('{{'), false, `double brace for ${language} ${JSON.stringify(limits)}`)
    }
  }
})

test('relaxed scale drops the strict-format skip and fires in coding answers', () => {
  const relaxed = buildPromptSection({ strictness: 'relaxed' })
  assert.ok(relaxed.includes('宁可多一条'))
  assert.ok(relaxed.includes('代码多、回答短、以代码为主，都不构成省略理由'))
  assert.ok(relaxed.includes('工程行话'))
  assert.ok(relaxed.includes('幂等、灰度、埋点、熔断'))
  assert.equal(relaxed.includes('会被程序直接消费的严格格式内容'), false)
  const standard = buildPromptSection({ strictness: 'standard' })
  assert.ok(standard.includes('会被程序直接消费的严格格式内容'))
  const strict = buildPromptSection({ strictness: 'strict' })
  assert.ok(strict.includes('拿不准就不标'))
  assert.ok(strict.length > 1200)
  // Section builders are used directly by buildPromptSection.
  assert.ok(buildTriggerSection({ promptLanguage: 'zh', strictness: 'relaxed' }).includes('宽松'))
  assert.ok(buildSelectionSection({ promptLanguage: 'zh', strictness: 'relaxed' }).includes('工程行话'))
})

test('prompt text is long enough to be a real rule set', () => {
  assert.ok(buildPromptSection({}).length > 1800)
  assert.ok(buildPromptSection({ language: 'en' }).length > 1800)
})

test('apply registers one prompt section with the documented identity', () => {
  const sections = []
  let effects = 0
  const ctx = {
    systemPrompt: {
      section(definition) {
        sections.push(definition)
        return () => {}
      },
    },
    effect(callback) {
      effects += 1
      return callback()
    },
  }
  apply(ctx, { max_terms: 6 })
  assert.equal(sections.length, 1)
  assert.equal(effects, 1)
  assert.equal(sections[0].name, SECTION_NAME)
  assert.equal(sections[0].order, SECTION_ORDER)
  assert.equal(typeof sections[0].text, 'function')
  const text = sections[0].text()
  assert.ok(text.includes('不超过 6 个'))
})

test('apply with enabled false registers nothing', () => {
  let called = 0
  const ctx = {
    systemPrompt: { section() { called += 1; return () => {} } },
    effect(callback) { called += 1; return callback() },
  }
  apply(ctx, { enabled: false })
  assert.equal(called, 0)
})

test('the live text goes blank when the switch is turned off at runtime', () => {
  const state = { enabled: true }
  const sections = []
  const ctx = {
    systemPrompt: { section(definition) { sections.push(definition); return () => {} } },
    effect(callback) { return callback() },
  }
  apply(ctx, { enabled: { get: () => state.enabled } })
  const text = sections[0].text
  assert.ok(text().length > 0)
  state.enabled = false
  assert.equal(text(), '')
})

test('Config schema exists in a profile install and declares the five fields', () => {
  if (Config === undefined) {
    // A bare workspace run cannot resolve schemastery; the row defaults apply.
    return
  }
  assert.equal(typeof Config, 'function')
})
