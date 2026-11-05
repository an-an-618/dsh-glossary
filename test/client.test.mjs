/**
 * Client-half tests for @an-an-618/dsh-glossary.
 *
 * Zero dependencies and no DOM: client.js is loaded into a Node vm whose only
 * globals are a fake window.__ModuleLoader__ and a minimal React stand-in. The
 * pure half (block parsing, form matching, config edits, card store) is fully
 * covered here; the DOM decorator is covered by test/fixture.html in a real
 * browser.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

const CLIENT_PATH = fileURLToPath(new URL('../client.js', import.meta.url))
const CLIENT_SOURCE = readFileSync(CLIENT_PATH, 'utf8')

function createFakeReact() {
  return {
    createElement(type, props, ...children) {
      const merged = props === null || props === undefined ? {} : Object.assign({}, props)
      if (children.length === 1) merged.children = children[0]
      else if (children.length > 1) merged.children = children
      return { type, props: merged }
    },
    useState(initial) {
      return [typeof initial === 'function' ? initial() : initial, () => {}]
    },
    useRef(initial) {
      return { current: initial }
    },
    useEffect() {},
    useLayoutEffect() {},
    useSyncExternalStore(subscribe, getSnapshot) {
      return getSnapshot()
    },
    memo(component) {
      return component
    },
  }
}

/** Load client.js once and return its `__test` surface. */
function loadClient() {
  const module = { exports: {} }
  const sandbox = {
    window: {
      __ModuleLoader__: {
        load(definition) {
          module.exports = definition.factory((id) => {
            if (id === 'react') return createFakeReact()
            throw new Error('unexpected require: ' + id)
          })
        },
      },
    },
    console,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    Promise,
    Map,
    Set,
    WeakMap,
    URL,
  }
  vm.createContext(sandbox)
  vm.runInContext(CLIENT_SOURCE, sandbox, { filename: 'client.js' })
  return module.exports.__test
}

const api = loadClient()

/** Values cross the vm realm boundary, so compare plain JSON, not prototypes. */
function plain(value) {
  return JSON.parse(JSON.stringify(value))
}

const ENTRIES = [
  { t: '回滚', forms: ['回滚'], kind: '行话', def: '发现新版本有问题时，把线上服务恢复到上一个稳定版本', more: '提前约定触发条件，崩溃率超阈值就回滚。', rel: ['灰度', '全量'], basis: '通用' },
  { t: '测试用例', forms: ['用例'], kind: '专业术语', def: '一条具体的测试步骤及其预期结果', basis: '通用' },
]

/** The block as the model writes it (opening tag, array; no closing tag). */
const BLOCK = api.OPEN_TAG + '\n' + JSON.stringify(ENTRIES)

/** The block as the shipped renderer leaves it: bare tag text and an escaped closing tag. */
const RENDERED_BLOCK = 'dsh:glossary\n' + JSON.stringify(ENTRIES) + '\n' + api.CLOSE_TAG

test('cli: client module exposes its test surface', () => {
  assert.equal(api.NS, 'dsh-glossary')
  assert.equal(api.OPEN_TAG, '<dsh:glossary>')
  assert.equal(api.TAG_HINT, 'dsh:glossary')
  assert.equal(api.CLOSE_TAG, '</dsh:glossary>')
  assert.equal(typeof api.components.GlossaryCard, 'function')
  assert.equal(typeof api.components.RowConfigPage, 'function')
  assert.deepEqual(plain(api.CONFIG_FIELDS), ['enabled', 'max_terms', 'def_max', 'more_max', 'language', 'strictness'])
})

test('cli: parseGlossaryText reads a trailing block and its entries', () => {
  const text = '建议先看风险点，回滚条件要提前说清，用例也要补完。\n\n' + BLOCK
  const block = api.parseGlossaryText(text)
  assert.notEqual(block, null)
  assert.equal(block.entries.length, 2)
  assert.equal(block.entries[0].t, '回滚')
  assert.equal(block.entries[0].kind, '行话')
  assert.deepEqual(plain(block.entries[0].rel), ['灰度', '全量'])
  assert.equal(block.entries[1].t, '测试用例')
  assert.deepEqual(plain(block.entries[1].forms), ['用例'])
  assert.equal(block.entries[1].basis, '通用')
  assert.ok(block.start < block.end)
  assert.ok(text.slice(block.start, block.end).startsWith('<dsh:glossary>'))
})

test('cli: parseGlossaryText reads the block the renderer actually leaves', () => {
  const text = '正文里先讲回滚，再讲用例。\n\n' + RENDERED_BLOCK
  const block = api.parseGlossaryText(text)
  assert.notEqual(block, null)
  assert.equal(block.entries.length, 2)
  assert.equal(text.slice(block.start, block.start + 12).toLowerCase(), 'dsh:glossary')
  assert.ok(text.slice(0, block.end).endsWith('</dsh:glossary>'))
  assert.equal(block.end, text.length)
})

test('cli: a prose mention of the tag is not a block', () => {
  assert.equal(api.parseGlossaryText('正文里提到 <dsh:glossary> 这个标签，但它后面没有数组。'), null)
  assert.equal(api.parseGlossaryText('正文里提到 dsh:glossary，后面跟一个普通数组 [1,2,3]。'), null)
  assert.equal(
    api.parseGlossaryText('示例：<dsh:glossary>\n[{"t":"X","forms":["X"],"kind":"行话","def":"释义","basis":"通用"}]\n后面还有正文。'),
    null,
    'a block followed by more text is left alone',
  )
})

test('cli: an empty array is hidden only when the tag precedes it', () => {
  const withTag = api.parseGlossaryText('正文。\ndsh:glossary\n[]')
  assert.notEqual(withTag, null)
  assert.equal(withTag.entries.length, 0)
  assert.equal(api.parseGlossaryText('正文之后一个空数组 []'), null)
})

test('cli: a five-entry block with ten nested arrays is still found', () => {
  const entries = [0, 1, 2, 3, 4].map((index) => ({
    t: '词' + String(index),
    forms: ['词' + String(index)],
    kind: '专业术语',
    def: '第 ' + String(index) + ' 个词的释义',
    rel: ['甲', '乙'],
    basis: '通用',
  }))
  const text = '正文依次提到 词0、词1、词2、词3、词4。\n\ndsh:glossary\n' + JSON.stringify(entries) + '\n</dsh:glossary>'
  const block = api.parseGlossaryText(text)
  assert.notEqual(block, null)
  assert.equal(block.entries.length, 5)
  assert.equal(text.slice(block.start, block.start + 12).toLowerCase(), 'dsh:glossary')
  assert.equal(block.end, text.length)
})

test('cli: the leak guard folds a block the strict parser rejects', () => {
  // Text after the block: strict parse refuses, the guard still hides it.
  const trailing = '正文提到回滚。\n\ndsh:glossary\n' + JSON.stringify([{ t: '回滚', forms: ['回滚'], kind: '行话', def: '恢复上一个稳定版本', basis: '通用' }]) + '\n</dsh:glossary>\n后面还有一句别的话。'
  assert.equal(api.parseGlossaryText(trailing), null)
  const guarded = api.findFallbackBlock(trailing)
  assert.notEqual(guarded, null)
  assert.equal(guarded.entries.length, 1)
  assert.ok(trailing.slice(guarded.start, guarded.end).startsWith('dsh:glossary'))
  assert.ok(trailing.slice(0, guarded.end).endsWith('</dsh:glossary>'))
  // Malformed JSON, but the marker and bracket pair are there: fold it anyway.
  const broken = '正文。\ndsh:glossary\n[{"t": "x",}]'
  assert.equal(api.parseGlossaryText(broken), null)
  const brokenGuard = api.findFallbackBlock(broken)
  assert.notEqual(brokenGuard, null)
  assert.equal(brokenGuard.entries.length, 0)
  // A prose mention far from any array is not a block.
  const mention = '正文提到 dsh:glossary 这个标签，然后列了一堆东西：'
  assert.equal(api.findFallbackBlock(mention), null)
  const farArray = 'dsh:glossary 这个标签，后面隔了很多字才出现一个数组：' + JSON.stringify([{ t: 'x', forms: ['x'], def: 'y' }])
  assert.equal(api.findFallbackBlock(farArray), null)
})

test('cli: parseGlossaryText drops entries whose forms are not in the answer', () => {
  const text = '正文里只有回滚。\n' + api.OPEN_TAG + '\n' + JSON.stringify([
    { t: '回滚', forms: ['回滚'], kind: '行话', def: '恢复上一个稳定版本', basis: '通用' },
    { t: '不存在', forms: ['不存在的词'], kind: '行话', def: '不该出现', basis: '通用' },
  ])
  const block = api.parseGlossaryText(text)
  assert.notEqual(block, null)
  assert.equal(block.entries.length, 1)
  assert.equal(block.entries[0].t, '回滚')
})

test('cli: a block with no usable entry is still returned so it gets hidden', () => {
  const text = '正文。\n' + api.OPEN_TAG + '\n' + JSON.stringify([{ t: 'X', forms: ['不在正文'], kind: '行话', def: '释义', basis: '通用' }])
  const block = api.parseGlossaryText(text)
  assert.notEqual(block, null)
  assert.equal(block.entries.length, 0)
})

test('cli: parseGlossaryText rejects malformed blocks', () => {
  assert.equal(api.parseGlossaryText('没有块'), null)
  assert.equal(api.parseGlossaryText('<dsh:glossary>'), null)
  assert.equal(api.parseGlossaryText('<dsh:glossary>\n[1,2,3]'), null)
  assert.equal(api.parseGlossaryText('<dsh:glossary>[{"t":]'), null)
  assert.equal(api.parseGlossaryText('<dsh:glossary>{"t":"x"}'), null)
  // An empty array is still a block worth hiding (the model should not write
  // one, but hiding beats leaking the tag into the answer).
  assert.notEqual(api.parseGlossaryText('<dsh:glossary>\n[]'), null)
  assert.equal(api.parseGlossaryText(''), null)
  assert.equal(api.parseGlossaryText(null), null)
})

test('cli: matchArrayEnd ignores brackets inside strings', () => {
  const text = '[{"t":"数组","def":"形如 a]b 的写法"}]'
  const end = api.matchArrayEnd(text, 0)
  assert.equal(end, text.length)
})

test('cli: normalizeEntry validates and clamps fields', () => {
  assert.equal(api.normalizeEntry(null), null)
  assert.equal(api.normalizeEntry({}), null)
  assert.equal(api.normalizeEntry({ t: 'x', forms: [], def: 'y' }), null)
  assert.equal(api.normalizeEntry({ t: 'x', forms: ['x'] }), null)
  const entry = api.normalizeEntry({
    t: '  回滚  ',
    forms: [' 回滚 ', '回滚', ''],
    kind: '',
    def: '  恢复上一个稳定版本  ',
    more: '',
    rel: ['灰度', '灰度', '全量', '再一个'],
    basis: '上下文推断',
  })
  assert.equal(entry.t, '回滚')
  assert.deepEqual(plain(entry.forms), ['回滚'])
  assert.equal(entry.kind, '专业术语')
  assert.equal(entry.def, '恢复上一个稳定版本')
  assert.equal(entry.more, '')
  assert.deepEqual(plain(entry.rel), ['灰度', '全量', '再一个'])
  assert.equal(entry.basis, '上下文推断')
  // Unknown basis falls back to the general-knowledge value.
  assert.equal(api.normalizeEntry({ t: 'x', forms: ['x'], def: 'y', basis: '猜的' }).basis, '通用')
})

test('cli: matchForms returns earliest, non-overlapping, longest-first matches', () => {
  const matches = api.matchForms('灰度发布前先做回滚演练，回滚脚本要测。', ['回滚', '灰度', '灰度发布'])
  assert.deepEqual(plain(matches.map((match) => match.form)), ['灰度发布', '回滚', '回滚'])
  assert.equal(matches[0].start, 0)
  // The second 回滚 starts after the first match ends.
  assert.ok(matches[1].start < matches[2].start)
  assert.deepEqual(plain(api.matchForms('', ['x'])), [])
  assert.deepEqual(plain(api.matchForms('text', [])), [])
  // Adjacent, non-overlapping occurrences are both kept.
  assert.deepEqual(plain(api.matchForms('banana', ['an']).map((m) => m.start)), [1, 3])
})

test('cli: card store opens, notifies and closes', () => {
  let calls = 0
  const unsubscribe = api.subscribePopover(() => {
    calls += 1
  })
  assert.equal(api.getPopover(), null)
  api.openPopover({ t: '回滚', def: '恢复', kind: '行话', more: '', rel: [], basis: '通用' }, {
    left: 10,
    top: 20,
    bottom: 40,
    right: 100,
    width: 90,
    height: 20,
  })
  assert.equal(calls, 1)
  assert.equal(api.getPopover().entry.t, '回滚')
  assert.equal(api.getPopover().rect.left, 10)
  api.closePopover()
  assert.equal(calls, 2)
  assert.equal(api.getPopover(), null)
  api.closePopover()
  assert.equal(calls, 2)
  unsubscribe()
  api.openPopover({ t: 'x' }, { left: 0, top: 0, bottom: 0, right: 0, width: 0, height: 0 })
  assert.equal(calls, 2)
  api.closePopover()
})

test('cli: translator falls back to the inline dictionary and fills params', () => {
  const translate = api.translator(undefined)
  assert.equal(translate('card.close'), '关闭')
  assert.equal(translate('mark.label', { term: '回滚' }), '术语：回滚（点击查看释义）')
  const withBrokenService = api.translator(() => undefined)
  assert.equal(withBrokenService('card.related'), '相关词')
})

test('cli: settings form reads effective values and diffs edits', () => {
  const form = {
    state: {
      status: 'ready',
      writable: true,
      revision: 3,
      value: { enabled: true, max_terms: 6, def_max: 40, more_max: 150, language: 'zh' },
    },
    mutate: () => Promise.resolve(true),
  }
  const value = api.configValueOf(form)
  assert.equal(value.max_terms, 6)
  assert.equal(value.language, 'zh')
  assert.deepEqual(plain(api.configValueOf(undefined)), plain(api.CONFIG_DEFAULTS))
  const ops = api.configOps({ ...value, max_terms: 2 }, value)
  assert.deepEqual(plain(ops), [{ op: 'set', path: ['max_terms'], value: 2 }])
  assert.deepEqual(plain(api.configOps(value, value)), [])
})

test('cli: every user-facing string is present in both locales', () => {
  const zh = Object.keys(api.MESSAGES.zh)
  const en = Object.keys(api.MESSAGES.en)
  assert.deepEqual(plain(zh.slice().sort()), plain(en.slice().sort()))
  for (const key of zh) {
    assert.notEqual(api.MESSAGES.zh[key].trim(), '')
    assert.notEqual(api.MESSAGES.en[key].trim(), '')
  }
})

test('cli: CSS carries the dashed mark and the card, and no raw colors outside tokens', () => {
  assert.ok(api.CSS.includes('.dsh-gl-mark'))
  assert.ok(api.CSS.includes('underline dashed'))
  assert.ok(api.CSS.includes('.dsh-gl-card'))
  assert.ok(api.CSS.includes('var(--dsw-alias-bg-layer-2'))
})
