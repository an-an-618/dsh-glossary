/**
 * Glossary — browser half of `@an-an-618/dsh-glossary`.
 *
 * The model appends a `<dsh:glossary>` JSON block to the end of its answer. The
 * shipped Markdown renderer has no message-content hook (and renders unknown
 * HTML as plain text), so this half works on the rendered transcript instead:
 *
 *  - a MutationObserver keeps finished answers in sync: the trailing data block
 *    is hidden (inline `display:none`, no content is removed from the React
 *    tree), and the first occurrence of every term is wrapped in a dashed,
 *    focusable `<span>`;
 *  - one delegated click/keyboard listener opens the definition card;
 *  - the card renders in the frame-wide `shell.overlay` slot, so it is never
 *    clipped by the transcript's scroll container;
 *  - the plugin settings page lives in `plugins.row.config`.
 *
 * Everything the decorator writes is tracked and restored when the plugin
 * unloads. Re-decoration is idempotent: a row that already carries marks is
 * left alone until a re-render removes them.
 *
 * No dynamic code, no network, no storage, no timers beyond the observer's
 * debounce and the chat-flow attachment retry.
 */
window.__ModuleLoader__.load({
  id: '@an-an-618/dsh-glossary',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    /** Locale namespace owned by this plugin. */
    const NS = 'dsh-glossary'

    /**
     * Markers around the block. The shipped Markdown renderer turns the opening
     * HTML block into bare text with the angle brackets stripped ("dsh:glossary")
     * and leaves a closing tag as escaped text, so detection never relies on the
     * tag alone: the block is identified by a trailing, valid JSON term array and
     * the tag (in either spelling) only widens the hidden range.
     */
    const OPEN_TAG = '<dsh:glossary>'
    const TAG_HINT = 'dsh:glossary'
    const CLOSE_TAG = '</dsh:glossary>'

    /** Hard cap mirrored from the Host prompt contract. */
    const MAX_ENTRIES = 8

    /** Inline dictionaries; the Client never depends on a separate locale file. */
    const MESSAGES = {
      zh: {
        'card.close': '关闭',
        'card.kind': '类型',
        'card.related': '相关词',
        'card.basis': '来源',
        'mark.label': '术语：{term}（点击查看释义）',
        'form.summary': '每轮最多 {count} 个术语 · 释义 {def} 字',
        'form.title': '术语解释',
        'form.desc': '改完点保存，下一轮生效；离开页面会丢弃未保存的修改。',
        'form.enabled': '启用插件',
        'form.enabledHint': '关闭后不再向系统提示注入术语解释规则。',
        'form.maxTerms': '每轮术语上限',
        'form.maxTermsHint': '1–8 个；候选超出时模型按优先级取舍。',
        'form.defMax': '一句话释义上限',
        'form.defMaxHint': '中文字数，20–120；英文约为四分之一词数。',
        'form.moreMax': '展开释义上限',
        'form.moreMaxHint': '中文字数，40–400；没有值得补充的内容时模型会省略。',
        'form.language': '语言',
        'form.languageHint': 'follow_user 让释义跟随用户语言；zh / en 同时固定规则文本语言。',
        'form.language.follow_user': '跟随用户',
        'form.language.zh': '中文',
        'form.language.en': 'English',
        'form.strictness': '触发尺度',
        'form.strictnessHint': '宽松 = 宁可多一条（代码场景也照标）；标准 = 原规则；严格 = 更克制。',
        'form.strictness.relaxed': '宽松（多标一些）',
        'form.strictness.standard': '标准',
        'form.strictness.strict': '严格（更克制）',
        'form.save': '保存',
        'form.saving': '保存中…',
        'form.saved': '已保存',
        'form.failed': '保存失败，请重试',
        'form.unchanged': '没有改动',
        'form.reset': '恢复默认',
        'form.notWritable': '当前配置不可写。',
        'form.noForm': 'Host 还没有提供这个插件的配置表单；确认插件已启用并且 Config schema 已加载。',
        'form.loading': '正在读取配置…',
      },
      en: {
        'card.close': 'Close',
        'card.kind': 'Type',
        'card.related': 'Related',
        'card.basis': 'Source',
        'mark.label': 'Term: {term} (click for the definition)',
        'form.summary': 'Up to {count} terms per reply · {def}-character definitions',
        'form.title': 'Glossary',
        'form.desc': 'Save to apply from the next turn; leaving the page discards unsaved edits.',
        'form.enabled': 'Enable plugin',
        'form.enabledHint': 'When off, no glossary rules are injected into the system prompt.',
        'form.maxTerms': 'Terms per reply',
        'form.maxTermsHint': '1-8; the model ranks candidates when there are more.',
        'form.defMax': 'One-sentence definition cap',
        'form.defMaxHint': 'Characters, 20-120; about a quarter as many English words.',
        'form.moreMax': 'Expanded definition cap',
        'form.moreMaxHint': 'Characters, 40-400; the model omits it when nothing is worth adding.',
        'form.language': 'Language',
        'form.languageHint': 'follow_user follows the user; zh / en also fix the rule language.',
        'form.language.follow_user': 'Follow user',
        'form.language.zh': 'Chinese',
        'form.language.en': 'English',
        'form.strictness': 'Trigger scale',
        'form.strictnessHint': 'Relaxed = rather one more term (coding answers too); standard = the original rules; strict = more conservative.',
        'form.strictness.relaxed': 'Relaxed (mark more)',
        'form.strictness.standard': 'Standard',
        'form.strictness.strict': 'Strict (mark less)',
        'form.save': 'Save',
        'form.saving': 'Saving…',
        'form.saved': 'Saved',
        'form.failed': 'Save failed, try again',
        'form.unchanged': 'No changes',
        'form.reset': 'Reset to defaults',
        'form.notWritable': 'This configuration is not writable.',
        'form.noForm': 'The Host did not provide a configuration form yet; check that the plugin is enabled and its Config schema loaded.',
        'form.loading': 'Loading configuration…',
      },
    }

    /** Last-resort dictionary for a composition without the locale service. */
    const FALLBACK_MESSAGES = MESSAGES.zh

    /**
     * Theme-token-only styling. The marks live in shipped Markdown DOM, so the
     * rule is injected once for the whole frame instead of being owned by a
     * component; `apply` removes it on unload.
     */
    const CSS = [
      '.dsh-gl-mark{text-decoration:underline dashed;text-decoration-color:var(--dsw-alias-state-business-primary,#4176e6);text-decoration-thickness:1px;text-underline-offset:3px;cursor:pointer;border-radius:2px;transition:background-color .12s ease,text-decoration-color .12s ease}',
      '.dsh-gl-mark:hover{background:var(--dsw-alias-interactive-bg-hover,#eef1f6);text-decoration-color:var(--dsw-alias-state-business-primary,#4176e6)}',
      '.dsh-gl-mark:focus-visible{outline:1.5px solid var(--dsw-alias-state-business-primary,#4176e6);outline-offset:2px}',
      '.dsh-gl-hidden,.dsh-gl-elem-hidden{display:none!important}',
      '.dsh-gl-card{position:fixed;z-index:60;box-sizing:border-box;width:min(340px,calc(100vw - 24px));max-height:min(60vh,420px);overflow:auto;padding:14px 16px 12px;border:0.5px solid var(--dsw-alias-border-l2,rgba(20,26,40,.1));border-radius:var(--dsw-radius-lg,12px);background:var(--dsw-alias-bg-layer-2,#f5f6f9);color:var(--dsw-alias-label-primary,#1b1f27);box-shadow:0 10px 30px rgba(15,20,30,.18);font-family:var(--dsw-font-family,inherit);pointer-events:auto}',
      '.dsh-gl-card-head{display:flex;align-items:flex-start;gap:8px}',
      '.dsh-gl-card-term{flex:1;min-width:0;font-size:15px;line-height:22px;font-weight:600;overflow-wrap:anywhere}',
      '.dsh-gl-card-kind{flex:none;padding:1px 7px;border-radius:999px;background:var(--dsw-alias-bg-layer-3,rgba(20,26,40,.06));color:var(--dsw-alias-label-secondary,#5b6372);font-size:11px;line-height:18px;font-weight:500}',
      '.dsh-gl-card-close{flex:none;appearance:none;width:22px;height:22px;padding:0;border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-label-tertiary,#8a93a3);font:inherit;font-size:16px;line-height:20px;cursor:pointer}',
      '.dsh-gl-card-close:hover{background:var(--dsw-alias-interactive-bg-hover,#eef1f6);color:var(--dsw-alias-label-primary,#1b1f27)}',
      '.dsh-gl-card-def{margin:8px 0 0;font-size:13px;line-height:20px;color:var(--dsw-alias-label-primary,#1b1f27);overflow-wrap:anywhere}',
      '.dsh-gl-card-more{margin:8px 0 0;font-size:12.5px;line-height:19px;color:var(--dsw-alias-label-secondary,#5b6372);overflow-wrap:anywhere}',
      '.dsh-gl-card-rel{display:flex;flex-wrap:wrap;align-items:center;gap:6px;margin-top:10px}',
      '.dsh-gl-card-rel-label{font-size:11px;line-height:18px;color:var(--dsw-alias-label-tertiary,#8a93a3)}',
      '.dsh-gl-card-rel-word{padding:1px 8px;border-radius:999px;border:0.5px solid var(--dsw-alias-border-l2,rgba(20,26,40,.1));color:var(--dsw-alias-label-secondary,#5b6372);font-size:11px;line-height:18px}',
      '.dsh-gl-card-basis{margin-top:10px;padding-top:8px;border-top:0.5px solid var(--dsw-alias-border-l2,rgba(20,26,40,.1));font-size:11px;line-height:18px;color:var(--dsw-alias-label-tertiary,#8a93a3)}',
      '.dsh-gl-form{display:flex;flex-direction:column;gap:14px;box-sizing:border-box;width:100%;max-width:640px;font-family:var(--dsw-font-family,inherit);color:var(--dsw-alias-label-primary,#1b1f27)}',
      '.dsh-gl-form-title{margin:0;font-size:14px;line-height:20px;font-weight:600}',
      '.dsh-gl-form-desc{margin:0;color:var(--dsw-alias-label-tertiary,#8a93a3);font-size:12px;line-height:18px}',
      '.dsh-gl-field{display:flex;flex-direction:column;gap:6px;padding-bottom:12px;border-bottom:0.5px solid var(--dsw-alias-border-l2,rgba(20,26,40,.1))}',
      '.dsh-gl-field:last-of-type{border-bottom:0;padding-bottom:0}',
      '.dsh-gl-field-head{display:flex;align-items:center;justify-content:space-between;gap:12px;min-width:0}',
      '.dsh-gl-field-label{font-size:13px;line-height:20px;font-weight:500;min-width:0}',
      '.dsh-gl-field-hint{color:var(--dsw-alias-label-tertiary,#8a93a3);font-size:12px;line-height:18px}',
      '.dsh-gl-check{width:18px;height:18px;margin:0;accent-color:var(--dsw-alias-state-business-primary,#4176e6);cursor:pointer}',
      '.dsh-gl-select,.dsh-gl-number{box-sizing:border-box;height:32px;border:0.5px solid var(--dsw-alias-border-l4,rgba(20,26,40,.16));border-radius:var(--dsw-radius-md,8px);background:var(--dsw-alias-bg-layer-2,#f5f6f9);color:var(--dsw-alias-label-primary,#1b1f27);font:inherit;font-size:13px;line-height:20px;padding:0 10px}',
      '.dsh-gl-select{min-width:180px;max-width:100%}',
      '.dsh-gl-number{width:84px}',
      '.dsh-gl-select:focus-visible,.dsh-gl-number:focus-visible,.dsh-gl-check:focus-visible{outline:1.5px solid var(--dsw-alias-state-business-primary,#4176e6);outline-offset:2px}',
      '.dsh-gl-form-foot{display:flex;align-items:center;gap:10px;flex-wrap:wrap}',
      '.dsh-gl-save{appearance:none;border:0.5px solid transparent;border-radius:var(--dsw-radius-md,8px);height:32px;padding:0 14px;background:var(--dsw-alias-state-business-primary,#4176e6);color:var(--dsw-alias-label-primary-inverted,#fff);font:inherit;font-size:13px;line-height:20px;font-weight:500;cursor:pointer}',
      '.dsh-gl-save:hover:not(:disabled){background:color-mix(in srgb,var(--dsw-alias-state-business-primary,#4176e6) 86%,#000)}',
      '.dsh-gl-save:disabled{opacity:.5;cursor:default}',
      '.dsh-gl-reset{appearance:none;border:0.5px solid var(--dsw-alias-border-l2,rgba(20,26,40,.1));border-radius:var(--dsw-radius-md,8px);height:32px;padding:0 14px;background:var(--dsw-alias-bg-layer-2,#f5f6f9);color:var(--dsw-alias-label-primary,#1b1f27);font:inherit;font-size:13px;line-height:20px;cursor:pointer}',
      '.dsh-gl-reset:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover,#eef1f6)}',
      '.dsh-gl-reset:disabled{opacity:.5;cursor:default}',
      '.dsh-gl-form-status{color:var(--dsw-alias-label-tertiary,#8a93a3);font-size:12px;line-height:18px}',
      '.dsh-gl-form-status[data-tone="error"]{color:var(--dsw-alias-state-error-primary,#c62828)}',
      '.dsh-gl-form-note{color:var(--dsw-alias-label-tertiary,#8a93a3);font-size:13px;line-height:20px}',
    ].join('\n')

    /* ------------------------------------------------------------------ *
     * Pure helpers (unit-tested without a DOM)
     * ------------------------------------------------------------------ */

    function isRecord(value) {
      return typeof value === 'object' && value !== null && !Array.isArray(value)
    }

    /**
     * Index just past the `]` that closes the array starting at `start`,
     * ignoring brackets inside JSON strings.
     * @returns {number} index past the closing bracket, or -1.
     */
    function matchArrayEnd(text, start) {
      if (typeof text !== 'string' || text[start] !== '[') return -1
      let depth = 0
      let inString = false
      let escaped = false
      for (let index = start; index < text.length; index++) {
        const char = text[index]
        if (inString) {
          if (escaped) escaped = false
          else if (char === '\\') escaped = true
          else if (char === '"') inString = false
          continue
        }
        if (char === '"') inString = true
        else if (char === '[') depth += 1
        else if (char === ']') {
          depth -= 1
          if (depth === 0) return index + 1
        }
      }
      return -1
    }

    /** Validate and normalize one glossary entry; `null` drops it. */
    function normalizeEntry(raw) {
      if (!isRecord(raw)) return null
      const t = typeof raw.t === 'string' ? raw.t.trim() : ''
      if (t === '' || t.length > 80) return null
      const forms = []
      if (Array.isArray(raw.forms)) {
        for (const form of raw.forms) {
          if (typeof form !== 'string') continue
          const trimmed = form.trim()
          if (trimmed === '' || trimmed.length > 80) continue
          if (forms.indexOf(trimmed) === -1) forms.push(trimmed)
          if (forms.length >= 6) break
        }
      }
      if (forms.length === 0) return null
      const definition = typeof raw.def === 'string' ? raw.def.trim() : ''
      if (definition === '') return null
      const more = typeof raw.more === 'string' ? raw.more.trim() : ''
      const rel = []
      if (Array.isArray(raw.rel)) {
        for (const word of raw.rel) {
          if (typeof word !== 'string') continue
          const trimmed = word.trim()
          if (trimmed === '' || trimmed.length > 40) continue
          if (rel.indexOf(trimmed) === -1) rel.push(trimmed)
          if (rel.length >= 3) break
        }
      }
      const kind = typeof raw.kind === 'string' && raw.kind.trim() !== '' ? raw.kind.trim().slice(0, 16) : '专业术语'
      const basis = raw.basis === '上下文推断' ? '上下文推断' : '通用'
      return {
        t,
        forms,
        kind,
        def: definition.slice(0, 400),
        more: more.slice(0, 800),
        rel,
        basis,
      }
    }

    /** Match forms plus the canonical term when the model forgot to list it. */
    function formsForMatch(entry) {
      const forms = Array.isArray(entry.forms) ? entry.forms.slice() : []
      if (typeof entry.t === 'string' && entry.t !== '' && forms.indexOf(entry.t) === -1) forms.push(entry.t)
      return forms
    }

    /** Parse and validate the JSON array itself; `null` when it is not ours. */
    function parseEntries(jsonText) {
      let parsed
      try {
        parsed = JSON.parse(jsonText)
      } catch (error) {
        return null
      }
      if (!Array.isArray(parsed)) return null
      const entries = []
      for (const item of parsed) {
        const entry = normalizeEntry(item)
        if (entry === null) continue
        entries.push(entry)
        if (entries.length >= MAX_ENTRIES) break
      }
      // A random JSON array must not be mistaken for a glossary block; an empty
      // array is only accepted when the block tag sits right before it.
      if (entries.length === 0 && parsed.length > 0) return null
      return entries
    }

    /** Widen the hidden range backwards over the block tag when it is nearby. */
    function blockStartIndex(text, arrayStart) {
      const windowStart = Math.max(0, arrayStart - 160)
      const before = text.slice(windowStart, arrayStart).toLowerCase()
      const at = before.lastIndexOf(TAG_HINT)
      if (at < 0) return arrayStart
      let start = windowStart + at
      // Cover the opening "<" of the angle-bracket spelling as well.
      if (start > 0 && text[start - 1] === '<') start -= 1
      return start
    }

    /**
     * Find the `[` that matches the `]` ending at `endExclusive`, scanning
     * backwards while skipping brackets inside JSON strings. A forward
     * candidate scan is not used: a five-entry block already contains ten
     * nested `forms`/`rel` arrays before its own opening bracket.
     * @returns {number} index of the opening bracket, or -1.
     */
    function matchArrayStart(text, endExclusive) {
      let depth = 1
      let inString = false
      for (let index = endExclusive - 2; index >= 0; index--) {
        const char = text[index]
        if (char === '"') {
          let backslashes = 0
          let cursor = index - 1
          while (cursor >= 0 && text[cursor] === '\\') {
            backslashes += 1
            cursor -= 1
          }
          if (backslashes % 2 === 0) inString = !inString
          continue
        }
        if (inString) continue
        if (char === ']') depth += 1
        else if (char === '[') {
          depth -= 1
          if (depth === 0) return index
        }
      }
      return -1
    }

    /**
     * Parse the trailing glossary block out of one answer's plain text.
     *
     * The real rendered text looks like this (the renderer drops the opening
     * angle brackets and escapes the closing tag):
     *
     *     ...answer text...
     *     dsh:glossary
     *     [{"t":"CDP",...}]
     *     </dsh:glossary>
     *
     * Only the row-final `]` is considered the block's outer bracket; it is
     * paired backwards and the array is validated. The block must end the row
     * (only whitespace and an optional closing tag may follow), which keeps a
     * prose mention of the tag from being mistaken for a block.
     *
     * @param {string} text
     * @returns {{ entries: object[], start: number, end: number } | null}
     */
    function parseGlossaryText(text) {
      if (typeof text !== 'string' || text === '') return null
      const lastClose = text.lastIndexOf(']')
      if (lastClose < 0) return null
      const trailing = text.slice(lastClose + 1)
      if (!/^\s*(?:<\/dsh:glossary>)?\s*$/i.test(trailing)) return null
      const arrayEnd = lastClose + 1
      const arrayStart = matchArrayStart(text, arrayEnd)
      if (arrayStart < 0) return null
      const entries = parseEntries(text.slice(arrayStart, arrayEnd))
      if (entries === null) return null
      const start = blockStartIndex(text, arrayStart)
      // An empty array is only a block when the tag right before it says so.
      if (entries.length === 0 && start === arrayStart) return null
      const body = text.slice(0, start)
      const usable = entries.filter((entry) => formsForMatch(entry).some((form) => body.indexOf(form) >= 0))
      return { entries: usable, start, end: text.length }
    }

    /**
     * Leak guard: hide a block even when the strict parse above rejects it.
     *
     * The strict parser only accepts a block that ends the row. A safety net is
     * still worth having: if a finished answer renders the marker at its tail
     * (last half of the row) and a bracket pair follows it, the block is folded
     * even when the JSON is malformed or some other text trails it. The gap
     * between the marker and `[` must be tiny, so a prose mention of the tag is
     * not mistaken for a block.
     * @param {string} text
     * @returns {{ entries: object[], start: number, end: number } | null}
     */
    function findFallbackBlock(text) {
      if (typeof text !== 'string' || text === '') return null
      const lower = text.toLowerCase()
      let marker = lower.lastIndexOf(TAG_HINT)
      while (marker >= 0) {
        // Skip the closing-tag occurrence: it sits after the array.
        const before = text.slice(Math.max(0, marker - 2), marker)
        if (before === '</') {
          marker = marker > 0 ? lower.lastIndexOf(TAG_HINT, marker - 1) : -1
          continue
        }
        // Only trust a marker near the end of the row: a mention mid-answer
        // must not fold everything after it.
        if (text.length - marker > Math.max(600, Math.ceil(text.length * 0.5))) return null
        const arrayStart = text.indexOf('[', marker + TAG_HINT.length)
        if (arrayStart < 0) return null
        if (text.slice(marker + TAG_HINT.length, arrayStart).trim().length > 8) {
          marker = marker > 0 ? lower.lastIndexOf(TAG_HINT, marker - 1) : -1
          continue
        }
        const arrayEnd = matchArrayEnd(text, arrayStart)
        if (arrayEnd < 0) return null
        let end = arrayEnd
        const closing = text.slice(arrayEnd).match(/^\s*(<\/dsh:glossary>)?/i)
        if (closing !== null) end = arrayEnd + closing[0].length
        const parsed = parseEntries(text.slice(arrayStart, arrayEnd))
        const entries = parsed === null ? [] : parsed
        const start = marker > 0 && text[marker - 1] === '<' ? marker - 1 : marker
        const body = text.slice(0, start)
        const usable = entries.filter((entry) => formsForMatch(entry).some((form) => body.indexOf(form) >= 0))
        return { entries: usable, start, end }
      }
      return null
    }

    /**
     * Non-overlapping occurrences of any form in one text node, earliest first
     * and longest form first at the same offset.
     * @param {string} nodeText
     * @param {string[]} forms
     * @returns {{ form: string, start: number, end: number }[]}
     */
    function matchForms(nodeText, forms) {
      if (typeof nodeText !== 'string' || nodeText === '' || !Array.isArray(forms)) return []
      const candidates = []
      for (const form of forms) {
        if (typeof form !== 'string' || form === '') continue
        let at = nodeText.indexOf(form)
        while (at >= 0) {
          candidates.push({ form, start: at, end: at + form.length })
          at = nodeText.indexOf(form, at + 1)
        }
      }
      candidates.sort((left, right) => left.start - right.start || right.end - left.end)
      const result = []
      let lastEnd = -1
      for (const candidate of candidates) {
        if (candidate.start < lastEnd) continue
        result.push(candidate)
        lastEnd = candidate.end
      }
      return result
    }

    /* ------------------------------------------------------------------ *
     * Locale helpers
     * ------------------------------------------------------------------ */

    function translator(t) {
      return function translate(key, params) {
        let text
        if (typeof t === 'function') {
          try {
            text = t(key, params)
          } catch (error) {
            text = undefined
          }
        }
        if (typeof text !== 'string' || text === key) {
          text = FALLBACK_MESSAGES[key] !== undefined ? FALLBACK_MESSAGES[key] : key
        }
        if (isRecord(params)) {
          for (const name of Object.keys(params)) {
            text = text.split('{' + name + '}').join(String(params[name]))
          }
        }
        return text
      }
    }

    /* ------------------------------------------------------------------ *
     * Definition-card store (the card renders in shell.overlay)
     * ------------------------------------------------------------------ */

    let popover = null
    const popoverListeners = new Set()
    const markRegistry = new Map()
    let markSequence = 0

    function getPopover() {
      return popover
    }

    function subscribePopover(listener) {
      popoverListeners.add(listener)
      return function unsubscribe() {
        popoverListeners.delete(listener)
      }
    }

    function emitPopover() {
      for (const listener of Array.from(popoverListeners)) {
        try {
          listener()
        } catch (error) {
          /* one bad subscriber must not break the others */
        }
      }
    }

    function openPopover(entry, rect) {
      popover = {
        entry,
        rect: { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height },
        key: markSequence,
      }
      emitPopover()
    }

    function closePopover() {
      if (popover === null) return
      popover = null
      emitPopover()
    }

    /* ------------------------------------------------------------------ *
     * Decorator: hide the data block, mark the terms
     * ------------------------------------------------------------------ */

    const SKIP_SELECTOR = 'pre, code, a, kbd, samp, textarea, .katex, .katex-display, [data-dsh-gl-hidden], [data-dsh-gl-mark]'
    const BLOCK_SELECTOR = 'p, li, blockquote, h1, h2, h3, h4, h5, h6, table, ul, ol, div'
    const FLOW_ROW_SELECTOR = '[data-chat-flow-kind="assistant-step"][data-chat-turn]'

    /** Records written into one row, so an unload can restore the DOM. */
    const written = []

    function isSkippedInText(element) {
      if (element === null || element === undefined) return false
      if (typeof element.closest !== 'function') return false
      return element.closest(SKIP_SELECTOR) !== null
    }

    function collectTextNodes(root) {
      const nodes = []
      if (typeof document.createTreeWalker !== 'function') return nodes
      const filter = typeof NodeFilter === 'undefined' ? undefined : { acceptNode: () => 1 }
      const walker = document.createTreeWalker(root, 4 /* NodeFilter.SHOW_TEXT */, filter)
      let node = walker.nextNode()
      while (node !== null) {
        nodes.push(node)
        node = walker.nextNode()
      }
      return nodes
    }

    function textNodeHasVisibleText(node) {
      if ((node.nodeValue || '').trim() === '') return false
      return !isSkippedInText(node.parentElement)
    }

    function elementHasVisibleText(element) {
      if (element === null) return false
      return collectTextNodes(element).some(textNodeHasVisibleText)
    }

    function unwrap(element) {
      if (element === null || element.parentNode === null) return
      const parent = element.parentNode
      while (element.firstChild !== null) parent.insertBefore(element.firstChild, element)
      parent.removeChild(element)
      if (typeof parent.normalize === 'function') parent.normalize()
    }

    function restoreAll() {
      closePopover()
      while (written.length > 0) {
        const record = written.pop()
        try {
          for (const span of record.spans) unwrap(span)
          for (const element of record.elements) {
            element.style.display = element.getAttribute('data-dsh-gl-display') || ''
            element.removeAttribute('data-dsh-gl-elem')
            element.removeAttribute('data-dsh-gl-display')
          }
        } catch (error) {
          /* a detached row needs no restoration */
        }
      }
      markRegistry.clear()
    }

    function restoreRow(row) {
      const state = row.__dshGlState
      if (state === undefined) return
      for (const span of state.spans) {
        try {
          unwrap(span)
        } catch (error) {
          /* detached */
        }
      }
      for (const element of state.elements) {
        element.style.display = element.getAttribute('data-dsh-gl-display') || ''
        element.removeAttribute('data-dsh-gl-elem')
        element.removeAttribute('data-dsh-gl-display')
      }
      row.__dshGlState = undefined
      delete row.__dshGlState
      const index = written.indexOf(state)
      if (index >= 0) written.splice(index, 1)
    }

    /** Wrap `[start, end)` of one text node in a hidden span. */
    function hideTextRange(node, start, end) {
      const parent = node.parentNode
      if (parent === null) return null
      const value = node.nodeValue || ''
      if (start <= 0 && end >= value.length) {
        const span = document.createElement('span')
        span.className = 'dsh-gl-hidden'
        span.setAttribute('data-dsh-gl-hidden', '')
        parent.insertBefore(span, node)
        span.appendChild(node)
        return span
      }
      const tail = node.splitText(start)
      tail.splitText(end - start)
      const span = document.createElement('span')
      span.className = 'dsh-gl-hidden'
      span.setAttribute('data-dsh-gl-hidden', '')
      if (tail.parentNode !== null) tail.parentNode.insertBefore(span, tail)
      span.appendChild(tail)
      return span
    }

    /**
     * Hide the parsed data block in one answer row. The block is a plain text
     * block in the shipped renderer, so it is hidden text-node by text-node and
     * the paragraphs/divs that only held that text are collapsed as well.
     */
    function hideBlock(row, block) {
      const spans = []
      const elements = []
      const textRecords = []
      const nodes = collectTextNodes(row)
      let offset = 0
      for (const node of nodes) {
        const value = node.nodeValue || ''
        const nodeStart = offset
        const nodeEnd = offset + value.length
        offset = nodeEnd
        if (nodeEnd <= block.start || nodeStart >= block.end) continue
        const localStart = Math.max(0, block.start - nodeStart)
        const localEnd = Math.min(value.length, block.end - nodeStart)
        const span = hideTextRange(node, localStart, localEnd)
        if (span !== null) {
          spans.push(span)
          textRecords.push({ node: span, offset: nodeStart })
        }
      }
      if (spans.length === 0) return { spans, elements }
      for (const element of Array.from(row.querySelectorAll(BLOCK_SELECTOR))) {
        if (element === row) continue
        // Collapse only blocks that used to hold the data block: they contain
        // one of our hidden spans and have no other visible text left.
        if (element.querySelector('[data-dsh-gl-hidden]') === null) continue
        if (elementHasVisibleText(element)) continue
        element.setAttribute('data-dsh-gl-display', element.style.display)
        element.setAttribute('data-dsh-gl-elem', '')
        element.style.display = 'none'
        elements.push(element)
      }
      return { spans, elements }
    }

    /** Wrap `[start, end)` of one text node in a clickable term. */
    function wrapTerm(node, start, end, entry) {
      const parent = node.parentNode
      if (parent === null) return null
      const id = 'g' + String(++markSequence)
      const tail = node.splitText(start)
      tail.splitText(end - start)
      const span = document.createElement('span')
      span.className = 'dsh-gl-mark'
      span.setAttribute('data-dsh-gl-mark', id)
      span.setAttribute('role', 'button')
      span.setAttribute('tabindex', '0')
      span.setAttribute('aria-label', entry.t)
      if (tail.parentNode !== null) tail.parentNode.insertBefore(span, tail)
      span.appendChild(tail)
      markRegistry.set(id, entry)
      return { span, after: span.nextSibling }
    }

    /** Mark the first occurrence of every entry, in reading order. */
    function markTerms(row, entries) {
      const spans = []
      const pending = entries.map((entry) => ({ entry }))
      if (pending.length === 0) return spans
      const nodes = collectTextNodes(row)
      for (const node of nodes) {
        if (pending.length === 0) break
        if (isSkippedInText(node.parentElement)) continue
        let current = node
        while (current !== null && pending.length > 0) {
          const text = current.nodeValue || ''
          if (text === '') break
          let best = null
          for (let index = 0; index < pending.length; index++) {
            const entry = pending[index].entry
            for (const form of formsForMatch(entry)) {
              const at = text.indexOf(form)
              if (at < 0) continue
              if (best === null || at < best.start || (at === best.start && form.length > best.length)) {
                best = { index, start: at, end: at + form.length, length: form.length }
              }
            }
          }
          if (best === null) break
          const entry = pending[best.index].entry
          const wrapped = wrapTerm(current, best.start, best.end, entry)
          if (wrapped === null) break
          spans.push(wrapped.span)
          pending.splice(best.index, 1)
          current = wrapped.after
        }
      }
      return spans
    }

    /**
     * Decorate one answer row. Idempotent: returns the same state when the row
     * already carries marks, and repairs rows whose marks a re-render removed.
     */
    function decorateRow(row) {
      if (row === null || row === undefined) return null
      // Streaming rewrites the Markdown text on every token; touching it then
      // would fight React. Wait for the settled row.
      if (typeof row.querySelector === 'function' && row.querySelector('[data-streaming]') !== null) return null
      const existing = row.__dshGlState
      // A block with no markable term hides without creating marks, so both
      // artifacts count as "already decorated"; otherwise the observer would
      // rewrite the row on every tick.
      const decorated = existing !== undefined
        && (row.querySelector('[data-dsh-gl-mark]') !== null || row.querySelector('[data-dsh-gl-hidden]') !== null)
      if (decorated) return existing
      if (existing !== undefined) restoreRow(row)
      const text = typeof row.textContent === 'string' ? row.textContent : ''
      const block = parseGlossaryText(text) || findFallbackBlock(text)
      if (block === null) return null
      const hidden = hideBlock(row, block)
      const marked = block.entries.length === 0 ? [] : markTerms(row, block.entries)
      if (hidden.spans.length === 0 && marked.length === 0) return null
      const state = {
        row,
        spans: hidden.spans.concat(marked),
        elements: hidden.elements,
        entries: block.entries,
      }
      row.__dshGlState = state
      written.push(state)
      return state
    }

    /** Decorate every answer row currently in the transcript. */
    function decorateVisibleRows() {
      if (typeof document === 'undefined' || typeof document.querySelectorAll !== 'function') return 0
      let count = 0
      for (const row of Array.from(document.querySelectorAll(FLOW_ROW_SELECTOR))) {
        const text = typeof row.textContent === 'string' ? row.textContent : ''
        if (text.indexOf(TAG_HINT) < 0 && text.indexOf('"forms"') < 0) continue
        const state = decorateRow(row)
        if (state !== null) count += 1
      }
      // Prune state for rows the transcript unmounted.
      for (let index = written.length - 1; index >= 0; index--) {
        if (!written[index].row.isConnected) written.splice(index, 1)
      }
      return count
    }

    /* ------------------------------------------------------------------ *
     * Definition card
     * ------------------------------------------------------------------ */

    const CARD_WIDTH = 340

    function GlossaryCard(props) {
      const tr = translator(props.t)
      const state = React.useSyncExternalStore(subscribePopover, getPopover, getPopover)
      const ref = React.useRef(null)
      const [placement, setPlacement] = React.useState(null)
      React.useLayoutEffect(() => {
        if (state === null) {
          setPlacement(null)
          return
        }
        const node = ref.current
        const width = node === null ? CARD_WIDTH : Math.min(CARD_WIDTH, node.offsetWidth || CARD_WIDTH)
        const height = node === null ? 160 : node.offsetHeight || 160
        const viewportWidth = typeof window === 'undefined' ? 1024 : window.innerWidth
        const viewportHeight = typeof window === 'undefined' ? 768 : window.innerHeight
        const anchor = state.rect
        let left = anchor.left + anchor.width / 2 - width / 2
        left = Math.max(12, Math.min(left, viewportWidth - width - 12))
        let top = anchor.bottom + 8
        if (top + height > viewportHeight - 12) top = anchor.top - height - 8
        top = Math.max(12, top)
        setPlacement({ left: String(Math.round(left)) + 'px', top: String(Math.round(top)) + 'px' })
      }, [state])
      if (state === null) return null
      const entry = state.entry
      const children = [
        h('div', { className: 'dsh-gl-card-head', key: 'head' },
          h('div', { className: 'dsh-gl-card-term' }, entry.t),
          h('span', { className: 'dsh-gl-card-kind' }, entry.kind),
          h('button', {
            type: 'button',
            className: 'dsh-gl-card-close',
            'aria-label': tr('card.close'),
            title: tr('card.close'),
            onClick: () => closePopover(),
          }, '×')),
        h('p', { className: 'dsh-gl-card-def', key: 'def' }, entry.def),
      ]
      if (entry.more !== '') children.push(h('p', { className: 'dsh-gl-card-more', key: 'more' }, entry.more))
      if (entry.rel.length > 0) {
        children.push(h('div', { className: 'dsh-gl-card-rel', key: 'rel' },
          h('span', { className: 'dsh-gl-card-rel-label' }, tr('card.related')),
          entry.rel.map((word, index) => h('span', { className: 'dsh-gl-card-rel-word', key: 'rel-' + String(index) }, word))))
      }
      children.push(h('div', { className: 'dsh-gl-card-basis', key: 'basis' }, tr('card.basis') + '：' + entry.basis))
      return h('div', {
        ref,
        className: 'dsh-gl-card',
        'data-dsh-gl-card': '',
        role: 'dialog',
        'aria-label': entry.t,
        tabIndex: -1,
        style: placement === null ? { visibility: 'hidden', left: '0px', top: '0px' } : placement,
      }, children)
    }

    /* ------------------------------------------------------------------ *
     * Plugin settings page: plugins.row.config
     * ------------------------------------------------------------------ */

    const CONFIG_FIELDS = ['enabled', 'max_terms', 'def_max', 'more_max', 'language', 'strictness']
    const CONFIG_DEFAULTS = {
      enabled: true,
      max_terms: 5,
      def_max: 40,
      more_max: 150,
      language: 'follow_user',
      strictness: 'standard',
    }

    function configValueOf(form) {
      const state = isRecord(form) ? form.state : undefined
      const value = isRecord(state) && isRecord(state.value) ? state.value : {}
      const merged = {}
      for (const field of CONFIG_FIELDS) {
        merged[field] = value[field] === undefined ? CONFIG_DEFAULTS[field] : value[field]
      }
      return merged
    }

    function configOps(draft, current) {
      const ops = []
      for (const field of CONFIG_FIELDS) {
        const next = isRecord(draft) ? draft[field] : undefined
        const previous = isRecord(current) ? current[field] : undefined
        if (next === previous) continue
        if (next === undefined) ops.push({ op: 'unset', path: [field] })
        else ops.push({ op: 'set', path: [field], value: next })
      }
      return ops
    }

    function RowConfigSummary(props) {
      const tr = translator(props.t)
      const value = configValueOf(props.form)
      return h('span', null, tr('form.summary', { count: String(value.max_terms), def: String(value.def_max) }))
    }

    function RowConfigPage(props) {
      const { t, form } = props
      const tr = translator(t)
      const state = isRecord(form) ? form.state : undefined
      const ready = isRecord(state) && state.status === 'ready' && isRecord(state.value)
      const writable = ready && state.writable !== false
      const revision = ready ? state.revision : undefined
      const [draft, setDraft] = React.useState(() => configValueOf(form))
      const [status, setStatus] = React.useState(null)
      const [busy, setBusy] = React.useState(false)
      const revisionRef = React.useRef(revision)
      React.useEffect(() => {
        if (!ready || revisionRef.current === revision) return
        revisionRef.current = revision
        setDraft(configValueOf(form))
        setStatus(null)
      }, [ready, revision, form])
      if (!ready) {
        const loading = isRecord(state) && (state.status === 'loading' || state.status === undefined)
        return h('div', { className: 'dsh-gl-form' },
          h('div', { className: 'dsh-gl-form-note' }, tr(loading ? 'form.loading' : 'form.noForm')))
      }
      const set = (field, value) => setDraft((previous) => {
        const next = {}
        for (const name of CONFIG_FIELDS) next[name] = previous[name]
        next[field] = value
        return next
      })
      const settle = (promise) => {
        setBusy(true)
        setStatus(null)
        Promise.resolve(promise)
          .then((ok) => {
            setBusy(false)
            setStatus(ok === false ? 'failed' : 'saved')
          })
          .catch(() => {
            setBusy(false)
            setStatus('failed')
          })
      }
      const save = () => {
        const ops = configOps(draft, configValueOf(form))
        if (ops.length === 0) {
          setStatus('unchanged')
          return
        }
        settle(form.mutate(ops, revision))
      }
      const reset = () => {
        const ops = CONFIG_FIELDS.map((field) => ({ op: 'unset', path: [field] }))
        settle(form.mutate(ops, revision))
      }
      const switchRow = (field, labelKey, hintKey) => h('div', { className: 'dsh-gl-field', key: field },
        h('div', { className: 'dsh-gl-field-head' },
          h('span', { className: 'dsh-gl-field-label' }, tr(labelKey)),
          h('input', {
            type: 'checkbox',
            className: 'dsh-gl-check',
            checked: draft[field] === true,
            disabled: !writable || busy,
            onChange: (event) => set(field, event.target.checked),
          })),
        h('div', { className: 'dsh-gl-field-hint' }, tr(hintKey)))
      const numberRow = (field, labelKey, hintKey, min, max) => h('div', { className: 'dsh-gl-field', key: field },
        h('div', { className: 'dsh-gl-field-head' },
          h('span', { className: 'dsh-gl-field-label' }, tr(labelKey)),
          h('input', {
            type: 'number',
            className: 'dsh-gl-number',
            min,
            max,
            step: 1,
            value: String(draft[field]),
            disabled: !writable || busy,
            onChange: (event) => {
              const parsed = Number(event.target.value)
              const next = Number.isFinite(parsed) ? Math.min(max, Math.max(min, Math.round(parsed))) : CONFIG_DEFAULTS[field]
              set(field, next)
            },
          })),
        h('div', { className: 'dsh-gl-field-hint' }, tr(hintKey)))
      const selectRow = (field, labelKey, hintKey, prefix, options) => h('div', { className: 'dsh-gl-field', key: field },
        h('div', { className: 'dsh-gl-field-head' },
          h('span', { className: 'dsh-gl-field-label' }, tr(labelKey)),
          h('select', {
            className: 'dsh-gl-select',
            value: String(draft[field]),
            disabled: !writable || busy,
            onChange: (event) => set(field, event.target.value),
          }, options.map((option) => h('option', { key: option, value: option }, tr('form.' + prefix + '.' + option))))),
        h('div', { className: 'dsh-gl-field-hint' }, tr(hintKey)))
      return h('section', { className: 'dsh-gl-form' },
        h('h3', { className: 'dsh-gl-form-title' }, tr('form.title')),
        h('p', { className: 'dsh-gl-form-desc' }, tr('form.desc')),
        switchRow('enabled', 'form.enabled', 'form.enabledHint'),
        numberRow('max_terms', 'form.maxTerms', 'form.maxTermsHint', 1, 8),
        numberRow('def_max', 'form.defMax', 'form.defMaxHint', 20, 120),
        numberRow('more_max', 'form.moreMax', 'form.moreMaxHint', 40, 400),
        selectRow('language', 'form.language', 'form.languageHint', 'language', ['follow_user', 'zh', 'en']),
        selectRow('strictness', 'form.strictness', 'form.strictnessHint', 'strictness', ['relaxed', 'standard', 'strict']),
        h('div', { className: 'dsh-gl-form-foot' },
          h('button', { type: 'button', className: 'dsh-gl-save', disabled: !writable || busy, onClick: save }, tr(busy ? 'form.saving' : 'form.save')),
          h('button', { type: 'button', className: 'dsh-gl-reset', disabled: !writable || busy, onClick: reset }, tr('form.reset')),
          status === null ? null : h('span', {
            className: 'dsh-gl-form-status',
            'data-tone': status === 'failed' ? 'error' : undefined,
            role: 'status',
          }, tr('form.' + status))),
        writable ? null : h('p', { className: 'dsh-gl-form-desc' }, tr('form.notWritable')))
    }

    function RowConfigView(props) {
      return props.view === 'summary' ? h(RowConfigSummary, props) : h(RowConfigPage, props)
    }

    /* ------------------------------------------------------------------ *
     * Frame-wide wiring: style, observer, delegated events
     * ------------------------------------------------------------------ */

    function isElement(value) {
      return typeof Element !== 'undefined' && value instanceof Element
    }

    /** Delegated click: open the card for a mark. */
    function handleClick(event) {
      if (!isElement(event.target)) return
      const mark = event.target.closest('[data-dsh-gl-mark]')
      if (mark === null) return
      event.preventDefault()
      event.stopPropagation()
      const id = mark.getAttribute('data-dsh-gl-mark')
      const entry = id === null ? undefined : markRegistry.get(id)
      if (entry === undefined) return
      openPopover(entry, mark.getBoundingClientRect())
    }

    /** Delegated pointerdown: dismiss when the pointer lands outside the card. */
    function handlePointerDown(event) {
      if (popover === null) return
      if (!isElement(event.target)) return
      if (event.target.closest('[data-dsh-gl-card]') !== null) return
      if (event.target.closest('[data-dsh-gl-mark]') !== null) return
      closePopover()
    }

    /** Delegated keyboard: activate a focused mark, close the card on Escape. */
    function handleKeyDown(event) {
      if (event.key === 'Escape') {
        closePopover()
        return
      }
      if (event.key !== 'Enter' && event.key !== ' ') return
      if (!isElement(event.target)) return
      const mark = event.target.closest('[data-dsh-gl-mark]')
      if (mark === null) return
      event.preventDefault()
      const id = mark.getAttribute('data-dsh-gl-mark')
      const entry = id === null ? undefined : markRegistry.get(id)
      if (entry === undefined) return
      openPopover(entry, mark.getBoundingClientRect())
    }

    function apply(ctx) {
      ctx.effect(() => ctx.locale.register(NS, { zh: MESSAGES.zh, en: MESSAGES.en }), 'dsh-glossary: locale')
      try {
        ctx.slots.inject('shell.overlay', () => ctx.slots.register({
          name: 'shell.overlay',
          id: 'glossary-card',
          order: 200,
          locale: NS,
        }, GlossaryCard))
      } catch (error) {
        if (ctx.logger !== undefined && typeof ctx.logger.warn === 'function') {
          ctx.logger.warn('dsh-glossary: shell.overlay unavailable', error)
        }
      }
      try {
        ctx.slots.inject('plugins.row.config', () => ctx.slots.register({
          name: 'plugins.row.config',
          key: '@an-an-618/dsh-glossary#glossary',
          locale: NS,
        }, RowConfigView))
      } catch (error) {
        if (ctx.logger !== undefined && typeof ctx.logger.warn === 'function') {
          ctx.logger.warn('dsh-glossary: row config page unavailable', error)
        }
      }
      ctx.effect(() => {
        if (typeof document === 'undefined') return undefined
        const style = document.createElement('style')
        style.setAttribute('data-dsh-glossary-style', '')
        style.textContent = CSS
        document.head.appendChild(style)
        document.addEventListener('click', handleClick, false)
        document.addEventListener('pointerdown', handlePointerDown, true)
        document.addEventListener('keydown', handleKeyDown, true)
        document.addEventListener('scroll', closePopover, true)
        if (typeof window !== 'undefined') window.addEventListener('resize', closePopover)
        let timer = null
        let observer = null
        const schedule = () => {
          if (timer !== null) return
          timer = setTimeout(() => {
            timer = null
            decorateVisibleRows()
          }, 180)
        }
        let attachTimer = null
        const attach = () => {
          if (observer !== null) return true
          const root = document.querySelector('[data-chat-flow]') || document.body
          if (root === null || root === undefined || typeof MutationObserver !== 'function') return false
          observer = new MutationObserver(schedule)
          // `data-streaming` disappears by attribute change only, so watch it
          // explicitly: that is the moment a finished answer becomes decorable.
          observer.observe(root, {
            childList: true,
            subtree: true,
            characterData: true,
            attributes: true,
            attributeFilter: ['data-streaming', 'hidden'],
          })
          return true
        }
        if (!attach()) {
          let attempts = 0
          attachTimer = setInterval(() => {
            attempts += 1
            if (attach() || attempts >= 40) {
              clearInterval(attachTimer)
              attachTimer = null
            }
          }, 500)
        }
        decorateVisibleRows()
        // Belt and braces: a 2.5s sweep hides anything a missed mutation or a
        // React re-render left unfolded. It is a no-op once rows carry marks.
        const sweep = setInterval(decorateVisibleRows, 2500)
        return () => {
          clearInterval(sweep)
          if (timer !== null) clearTimeout(timer)
          if (attachTimer !== null) clearInterval(attachTimer)
          if (observer !== null) observer.disconnect()
          document.removeEventListener('click', handleClick, false)
          document.removeEventListener('pointerdown', handlePointerDown, true)
          document.removeEventListener('keydown', handleKeyDown, true)
          document.removeEventListener('scroll', closePopover, true)
          if (typeof window !== 'undefined') window.removeEventListener('resize', closePopover)
          restoreAll()
          style.remove()
        }
      }, 'dsh-glossary: transcript decorator')
    }

    return {
      inject: ['slots', 'locale'],
      apply,
      // Pure helpers and component entry points, exercised by test/client.test.mjs
      // in a Node vm and by test/fixture.html in a real browser.
      __test: {
        NS,
        OPEN_TAG,
        TAG_HINT,
        CLOSE_TAG,
        MESSAGES,
        CSS,
        isRecord,
        matchArrayEnd,
        normalizeEntry,
        parseGlossaryText,
        findFallbackBlock,
        matchArrayStart,
        matchForms,
        translator,
        getPopover,
        subscribePopover,
        openPopover,
        closePopover,
        decorateRow,
        decorateVisibleRows,
        restoreAll,
        handleClick,
        handlePointerDown,
        handleKeyDown,
        components: { GlossaryCard, RowConfigView, RowConfigPage, RowConfigSummary },
        CONFIG_FIELDS,
        CONFIG_DEFAULTS,
        configValueOf,
        configOps,
        FLOW_ROW_SELECTOR,
      },
    }
  },
})
