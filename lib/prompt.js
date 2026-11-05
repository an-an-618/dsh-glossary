/**
 * Glossary — model-facing text and row configuration.
 *
 * `buildPromptSection` is the system-prompt section (name `glossary`, order
 * 2450). It carries the whole behavioural contract: when to skip, which words
 * to mark, how to write `def`/`more`/`rel`, and the trailing data-block format
 * the Client parses and hides.
 *
 * Trigger and selection live behind one `strictness` switch so the plugin can
 * fire more or less often without editing prompt text:
 *
 *   relaxed  — skip only when there is genuinely nothing to explain; coding
 *              answers with engineering jargon always produce a block.
 *   standard — the original contract (strict formats skip the turn).
 *   strict   — additionally skip borderline words and short answers.
 *
 * DSH treats system-prompt sections as templates: a double-brace sequence is a
 * variable reference and any other double-brace content fails every turn. This
 * module therefore never emits a double brace; the single-brace placeholders
 * below are filled by `fill()` and the JSON example only ever contains single
 * braces.
 *
 * No dynamic code and no I/O.
 *
 * @module glossary/lib/prompt
 */

/** Prompt section identity required by `ctx.systemPrompt.section()`. */
export const SECTION_NAME = 'glossary'

/**
 * Section order: after `intelligent-ui` (2400) and before `hook-followup`
 * (2500), so the in-body output contract sits next to the other turn-level
 * rules without overriding them.
 */
export const SECTION_ORDER = 2450

/** Accepted `language` values. */
export const LANGUAGES = ['follow_user', 'zh', 'en']

/** Accepted `strictness` values, from most eager to most conservative. */
export const STRICTNESS = ['relaxed', 'standard', 'strict']

/** Accepted `kind` values written by the model. */
export const KINDS = ['专业术语', '缩写', '行话', '学术概念', '内部名词']

/** Accepted `basis` values written by the model. */
export const BASES = ['通用', '上下文推断']

/** Definition lengths the model must respect. */
export const LIMITS = Object.freeze({
  maxTerms: { min: 1, max: 8, fallback: 5 },
  defMax: { min: 20, max: 120, fallback: 40 },
  moreMax: { min: 40, max: 400, fallback: 150 },
})

function clampInt(value, bounds) {
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(parsed)) return bounds.fallback
  return Math.min(bounds.max, Math.max(bounds.min, Math.round(parsed)))
}

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Normalize the row config without failing activation.
 * @param {unknown} config - `cordis.patch.yml` row config.
 * @returns {{ enabled: boolean, maxTerms: number, defMax: number, moreMax: number, language: string, strictness: string, promptLanguage: 'zh'|'en' }}
 */
export function normalizeConfig(config) {
  const source = isRecord(config) ? config : {}
  const language = LANGUAGES.indexOf(source.language) === -1 ? 'follow_user' : source.language
  const strictness = STRICTNESS.indexOf(source.strictness) === -1 ? 'standard' : source.strictness
  return {
    enabled: source.enabled !== false,
    maxTerms: clampInt(source.max_terms, LIMITS.maxTerms),
    defMax: clampInt(source.def_max, LIMITS.defMax),
    moreMax: clampInt(source.more_max, LIMITS.moreMax),
    language,
    strictness,
    // `follow_user` fixes the definition language; the rules themselves stay
    // Chinese unless the plugin is configured for English.
    promptLanguage: language === 'en' ? 'en' : 'zh',
  }
}

/** The omission contract, per strictness. */
export function buildTriggerSection(settings) {
  const strictness = STRICTNESS.indexOf(settings.strictness) === -1 ? 'standard' : settings.strictness
  if (settings.promptLanguage === 'en') {
    if (strictness === 'relaxed') {
      return [
        '### 2. When to skip the whole block (relaxed)',
        'Skip only when:',
        '- The answer genuinely contains no word worth explaining;',
        '- This turn is a refusal, an intermediate tool-calling step, or still waiting for a tool result;',
        '- The user is in an emotional crisis, grieving, and so on;',
        '- The user explicitly said they do not want glossary entries.',
        'Otherwise always append the block, even for a single word. Lots of code, a short answer, or an answer that is mostly code is not a reason to skip: the prose, the step-by-step explanation, and the notes around the code usually contain engineering jargon. Code only / JSON only / translation only skips the turn only because there is no prose to mark. The data block is folded away by the front end, so it does not pollute the answer.',
        'When in doubt between marking and skipping, mark: a plain, concrete definition is cheap, a missed term costs the reader a lookup.',
      ].join('\n')
    }
    if (strictness === 'strict') {
      return [
        '### 2. When to skip the whole block (strict)',
        'Skip when:',
        '- The answer has no concept that really needs explaining (borderline, nice-to-have words do not count);',
        '- The output is code only, JSON only, translation only, or a strict format consumed directly by a program;',
        '- This turn is a refusal, an intermediate tool-calling step, or still waiting for a tool result;',
        '- The user is in an emotional crisis, grieving, and so on;',
        '- The user explicitly said they do not want glossary entries;',
        '- The user asked for brevity, or the answer is only a couple of sentences;',
        '- Every candidate is a word this field already knows.',
        'In every other case append the block.',
      ].join('\n')
    }
    return [
      '### 2. Skip the whole block only in these cases',
      '- The answer contains no word worth explaining;',
      '- The output is code only, JSON only, translation only, or a strict format consumed directly by a program;',
      '- This turn is a refusal, an intermediate tool-calling step, or still waiting for a tool result;',
      '- The user is in an emotional crisis, grieving, and so on;',
      '- The user explicitly said they do not want glossary entries.',
      'In every other case, when the answer really contains words that qualify and that you can define accurately, append the block.',
    ].join('\n')
  }
  if (strictness === 'relaxed') {
    return [
      '### 二、触发尺度（宽松：宁可多一条，不要漏掉）',
      '只有以下情况才整块省略：',
      '- 正文里确实一个可解释的词都没有；',
      '- 本轮是拒绝回答、工具调用的中间步骤，或仍在等待工具结果；',
      '- 用户处于情绪危机、哀伤等情境；',
      '- 用户明确表示不需要名词解释。',
      '其余情况一律附加术语块，哪怕只有 1 个词。代码多、回答短、以代码为主，都不构成省略理由：说明文字、逐步解释、代码旁边的正文里通常就有工程行话。纯代码 / 纯 JSON / 纯译文之所以可能省略，只是因为那时没有正文可标，而不是因为「格式严格」。数据块在前端会被折叠，不会污染正文。',
      '拿不准标还是不标时，选择标：一句朴素的释义成本很低，漏掉的词却要让用户自己查。',
    ].join('\n')
  }
  if (strictness === 'strict') {
    return [
      '### 二、触发尺度（严格）',
      '以下情况整块省略：',
      '- 正文里没有必须解释的概念（可标可不标的边缘词不标）；',
      '- 本轮输出是纯代码、纯 JSON、纯译文，或会被程序直接消费的严格格式内容；',
      '- 本轮是拒绝回答、工具调用的中间步骤，或仍在等待工具结果；',
      '- 用户处于情绪危机、哀伤等情境；',
      '- 用户明确表示不需要名词解释；',
      '- 用户要求简短，或回答只有一两句话；',
      '- 候选词对目标读者已经属于常识。',
      '其余情况附加术语块。',
    ].join('\n')
  }
  return [
    '### 二、只有以下情况才整块省略',
    '- 正文里没有值得解释的词；',
    '- 本轮输出是纯代码、纯 JSON、纯译文，或会被程序直接消费的严格格式内容；',
    '- 本轮是拒绝回答、工具调用的中间步骤，或仍在等待工具结果；',
    '- 用户处于情绪危机、哀伤等情境；',
    '- 用户明确表示不需要名词解释。',
    '其余情况只要正文里确实有符合条件、讲得准的词，就附加术语块。',
  ].join('\n')
}

/** Which words count, per strictness. */
export function buildSelectionSection(settings) {
  const strictness = STRICTNESS.indexOf(settings.strictness) === -1 ? 'standard' : settings.strictness
  if (settings.promptLanguage === 'en') {
    if (strictness === 'relaxed') {
      return [
        '### 3. Which words to mark (relaxed)',
        'Mark:',
        '- Technical terms and academic concepts (for example "survivorship bias", "Split-CP");',
        '- Abbreviations and acronyms, especially ambiguous ones (for example "QA", "ROI", "SFT");',
        '- Industry and engineering jargon: canary, idempotent, circuit breaker, SLO, P99, regression test, cold start, instrumentation. The test is "would someone new to this project or field have to look it up", not "does a senior engineer already know it";',
        '- Concepts that first appear in this answer and are needed to follow it.',
        'Do not mark:',
        '- Everyday words and basic programming words that need no explanation in this context (function, variable, interface, error, deploy, and so on);',
        '- Words the user themself used naturally where the context shows they understand them;',
        '- Words already marked earlier in this conversation;',
        '- Words that occur only in code blocks, inline code, or link text;',
        '- The core topic of this answer when the answer already explains it fully.',
        'Borderline case: an engineering word that sits between "basic" and "specialised" (idempotent, canary, instrumentation) is still worth marking when the answer uses it with a specific meaning.',
        'Count and priority: at most {max_terms} per turn. When candidates exceed the cap, keep in this order: ambiguous abbreviation > concept necessary to follow the answer > jargon > everything else. One entry per concept, even when the answer spells it several ways.',
        'Internal names (special rule): company-internal system names, project code names, and organisation-private jargon cannot be known from general knowledge. Mark them only when this conversation explicitly established their meaning, and then `basis` must be "上下文推断". With no basis in the conversation, never mark them and never guess a meaning from the surface form.',
      ].join('\n')
    }
    if (strictness === 'strict') {
      return [
        '### 3. Which words to mark (strict)',
        'Mark only words a general reader plausibly cannot follow without help:',
        '- Technical terms and academic concepts;',
        '- Abbreviations whose expansion is not common knowledge;',
        '- Industry jargon that is opaque outside the field.',
        'Do not mark everyday words, words this field already knows, words the user themself used, words already marked in this conversation, words that occur only in code or link text, or the core topic the answer already explains.',
        'Count and priority: at most {max_terms} per turn; when in doubt, skip.',
        'Internal names follow the same rule: only with a meaning established in this conversation, and `basis` must be "上下文推断"; never guess.',
      ].join('\n')
    }
    return [
      '### 3. Which words to mark',
      'Mark:',
      '- Technical terms and academic concepts (for example "survivorship bias", "Split-CP");',
      '- Abbreviations and acronyms, especially ambiguous ones (for example "QA", "ROI", "SFT");',
      '- Industry jargon and workplace shorthand (for example "canary", "align", "full rollout");',
      '- Concepts that first appear in this answer and are necessary to follow it.',
      'Do not mark:',
      '- Everyday words, or words an educated general reader already knows;',
      '- Words the user themself used naturally in this conversation (they most likely know them);',
      '- Words already marked earlier in this conversation;',
      '- Words that occur only in code blocks, inline code, or link text;',
      '- The core topic of this answer when the answer already explains it fully (repeating it is pointless).',
      'Count and priority: at most {max_terms} per turn. When candidates exceed the cap, keep in this order: ambiguous abbreviation > concept necessary to follow the answer > jargon > everything else. One entry per concept, even when the answer spells it several ways.',
      'Internal names (special rule): company-internal system names, project code names, and organisation-private jargon cannot be known from general knowledge. Mark them only when this conversation explicitly established their meaning, and then `basis` must be "上下文推断". With no basis in the conversation, never mark them and never guess a meaning from the surface form.',
    ].join('\n')
  }
  if (strictness === 'relaxed') {
    return [
      '### 三、选词规则（宽松）',
      '应当标注：',
      '- 专业术语、学术概念（如“幸存者偏差”“Split-CP”）；',
      '- 缩写与简称，尤其一词多义的缩写（如“QA”“ROI”“SFT”）；',
      '- 行业与工程行话：灰度、幂等、熔断、埋点、SLO、P99、回归测试、冷启动这类。判断标准是「刚接触这个项目或这个领域的人要不要查一下」，而不是「资深工程师是不是都懂」；',
      '- 正文中首次出现、理解它对读懂上下文有必要的概念。',
      '不得标注：',
      '- 日常词汇，以及本轮语境里无需解释的基础编程词（函数、变量、接口、报错、部署……）；',
      '- 用户本人已经自然使用过、且上下文显示其清楚含义的词；',
      '- 本对话历史里已经标注过的词；',
      '- 只出现在代码块、行内代码、链接文字中的词；',
      '- 本轮正文的核心主题词，且正文已对其做了完整解释的。',
      '边界情况：介于基础词与专业词之间的工程词（幂等、灰度、埋点、熔断），只要正文用法带一点特定含义，就标出来。',
      '数量与优先级：每轮不超过 {max_terms} 个。候选超出时，优先保留：一词多义的缩写 > 理解正文必需的概念 > 行话 > 其他。同一概念只出一条，即使正文中有多种写法。',
      '内部名词（特别规则）：公司内部系统名、项目代号、组织内部黑话等，模型无法从通用知识中得知其含义。仅当对话上下文中明确给出过其含义时才可标注，且 basis 必须填“上下文推断”。上下文中没有依据时，一律不标，严禁根据字面猜测内部名词的含义。',
    ].join('\n')
  }
  if (strictness === 'strict') {
    return [
      '### 三、选词规则（严格）',
      '只标本领域之外的普通读者确实读不懂的词：专业术语、学术概念、非常识的缩写、行外看不懂的行话。',
      '不标日常词、本领域常识词、用户本人用过的词、历史已标注的词、只出现在代码或链接文字里的词、正文已完整解释的核心主题词。',
      '数量与优先级：每轮不超过 {max_terms} 个；拿不准就不标。',
      '内部名词：仅在对话中明确给出过含义时标注，basis 填“上下文推断”，严禁猜测。',
    ].join('\n')
  }
  return [
    '### 三、选词规则',
    '应当标注：',
    '- 专业术语、学术概念（如“幸存者偏差”“Split-CP”）；',
    '- 缩写与简称，尤其一词多义的缩写（如“QA”“ROI”“SFT”）；',
    '- 行业行话、职场黑话（如“灰度”“抓手”“对齐”“全量”）；',
    '- 正文中首次出现、且理解它对读懂上下文有必要的概念。',
    '不得标注：',
    '- 日常词汇，以及受过教育的普通读者都认识的词；',
    '- 用户本人在对话中已经自然使用过的词（说明用户大概率已懂）；',
    '- 本对话历史里已经标注过的词；',
    '- 只出现在代码块、行内代码、链接文字中的词；',
    '- 本轮正文的核心主题词，且正文已对其做了完整解释的（重复解释没有意义）。',
    '数量与优先级：每轮不超过 {max_terms} 个。候选超出时，优先保留：一词多义的缩写 > 理解正文必需的概念 > 行话 > 其他。同一概念只出一条，即使正文中有多种写法。',
    '内部名词（特别规则）：公司内部系统名、项目代号、组织内部黑话等，模型无法从通用知识中得知其含义。仅当对话上下文中明确给出过其含义时才可标注，且 basis 必须填“上下文推断”。上下文中没有依据时，一律不标，严禁根据字面猜测内部名词的含义。',
  ].join('\n')
}

const ZH_RULES = [
  '## 术语解释（glossary）',
  '',
  '正文照常写完后，在回复的最末尾附加一个术语数据块，列出正文里用户可能看不懂的复杂、专业或行话类名词及其释义。前端会把这些词在正文中标成可点击的虚线，点击弹出释义卡；用户不必再发一轮消息就能看懂单个词或短语。衡量标准：被标出的词确实是用户可能不懂的，释义准确、贴合本轮语境，看完就能继续读正文。标得多不算成功。',
  '',
  '### 一、前置原则（优先级最高）',
  '1. 正文照常写，不因本插件改变内容、长度、措辞或格式。正文里不得出现任何术语标签、标记或括号注释。',
  '2. 释义必须是本轮语境里的含义。一个词有多种含义时，只解释它在这段正文里的那一种。',
  '3. 准确优先于覆盖。不确定的词不标，绝不编造释义。',
  '',
  '@@TRIGGER@@',
  '',
  '@@SELECTION@@',
  '',
  '### 四、释义写法',
  'def（必填，一句话释义）：不超过 {def_max} 字，读完就能理解该词在正文里的意思。缩写先给全称，再给含义，例如“Quality Assurance，质量保障，负责测试产品是否符合需求、有无缺陷”；不得循环定义；不得在释义中引入另一个未解释的术语；不得照抄正文中已有的句子。',
  'more（选填，展开释义）：不超过 {more_max} 字。写一句话释义容纳不下但有用的内容：核心机制、与易混概念的区别、一个具体例子、适用边界。没有值得补充的内容就省略该字段，不要凑字数。',
  'rel（选填，相关词）：0–3 个。优先选与该词容易混淆的概念，或理解它之后自然想了解的下一个概念。只写词本身，不写释义。',
  'kind（必填）：专业术语 | 缩写 | 行话 | 学术概念 | 内部名词。',
  'basis（必填）：“通用”表示释义来自通用知识；“上下文推断”表示释义来自本对话上下文。',
  '',
  '### 五、输出格式',
  '术语块放在正文之后、回复的最末尾，后面不要再有任何文字；若同时启用了其他往末尾追加内容的插件，术语块放在它们之前。标签内只放一个合法 JSON 数组，不加任何注释、说明文字或 Markdown 代码围栏。所有字符串使用英文双引号，字符串内部不换行，需要引号时用中文引号“”或转义 \\"。',
  '',
  '<dsh:glossary>',
  '[',
  '  {"t":"规范词名","forms":["正文中的写法1","写法2"],"kind":"缩写","def":"一句话释义","more":"展开释义","rel":["相关词1","相关词2"],"basis":"通用"}',
  ']',
  '',
  '格式要求：',
  '1. forms 至少包含一项，且至少有一项确实出现在正文中；每一项必须与正文中出现的字符串逐字一致，包括大小写、全角半角和空格——前端依赖它在正文中定位并加虚线，不一致就无法定位。',
  '2. 字段顺序固定为：t, forms, kind, def, more, rel, basis。选填字段没有内容时直接省略。',
  '3. 没有要解释的词时，整块不写，不要写空数组。',
  '',
  '示例：用户问“我们组下周要灰度，但 QA 那边还没测完，我该怎么跟 leader 说？”，正文提到“回滚”“用例”（“灰度”“QA”是用户自己说的词，不标）：',
  '<dsh:glossary>',
  '[',
  '  {"t":"回滚","forms":["回滚"],"kind":"行话","def":"发现新版本有问题时，把线上服务恢复到上一个稳定版本","more":"通常需要提前约定触发条件，比如崩溃率或核心指标跌幅超过阈值就自动或手动回滚，这样灰度出问题时损失可控。","rel":["灰度","全量"],"basis":"通用"},',
  '  {"t":"测试用例","forms":["用例"],"kind":"专业术语","def":"一条具体的测试步骤及其预期结果，用来检验某个功能是否正常","rel":["QA","冒烟测试"],"basis":"通用"}',
  ']',
  '',
  '反例（不要这样写）：循环定义（“灰度发布就是灰度地发布新版本”）；标日常词（“数据”）；按字面编造内部名词释义；forms 与正文大小写不一致；释义里又引入未解释的术语；术语块之后还有其他文字。',
]

const EN_RULES = [
  '## Glossary (glossary)',
  '',
  'After writing the answer normally, append a term data block at the very end of the reply. It lists the complex, technical, or jargon words in the answer that the user may not understand, with their definitions. The front end marks those words in the answer as clickable dashed terms; clicking one opens a definition card, so the user can understand a single word without sending another turn. The measure of success is that the marked words are ones the user plausibly does not know, that each definition is accurate and true of this answer, and that reading it lets the user continue reading. Marking a lot is not success.',
  '',
  '### 1. Ground rules (highest priority)',
  '1. Write the answer exactly as usual: this plugin must not change its content, length, wording, or format. No term tag, marker, or parenthetical gloss may appear inside the answer text.',
  '2. A definition must be the meaning used in this answer. When a word has several meanings, define only the one used here.',
  '3. Accuracy beats coverage. Do not mark a word you are unsure about, and never invent a definition.',
  '',
  '@@TRIGGER@@',
  '',
  '@@SELECTION@@',
  '',
  '### 4. How to write the definition',
  'def (required, one sentence): at most {def_max} characters (about 25 English words); after reading it the user understands what the word means in this answer. For an abbreviation, give the full form first, then the meaning, for example "Quality Assurance: the function that tests whether a product meets its requirements and has no defects". No circular definition; do not introduce another unexplained term; do not copy a sentence from the answer.',
  'more (optional, expanded definition): at most {more_max} characters (about 90 English words). Use it only for what does not fit in one sentence: the core mechanism, the difference from a confusable concept, a concrete example, or where it applies. Omit the field when there is nothing worth adding; do not pad it.',
  'rel (optional, related words): 0-3 items. Prefer concepts easily confused with this one, or the natural next concept to look up. Write the words only, never their definitions.',
  'kind (required): 专业术语 | 缩写 | 行话 | 学术概念 | 内部名词.',
  'basis (required): "通用" when the definition comes from general knowledge; "上下文推断" when it comes from this conversation.',
  '',
  '### 5. Output format',
  'Put the term block after the answer, at the very end of the reply, with nothing after it; when another plugin also appends content at the end, put the glossary block before it. The tag holds exactly one valid JSON array, with no comments, no prose, and no Markdown code fence. Every string uses plain double quotes, no string contains a newline, and use curly quotes “” or an escaped \\" when a definition needs a quote.',
  '',
  '<dsh:glossary>',
  '[',
  '  {"t":"canonical term","forms":["form as written in the answer"],"kind":"缩写","def":"one-sentence definition","more":"expanded definition","rel":["related word"],"basis":"通用"}',
  ']',
  '',
  'Format rules:',
  '1. `forms` has at least one item and at least one of them actually occurs in the answer; every item must match the answer character for character, including case and spacing: the front end locates the word in the answer by that exact string. A mismatch means it cannot be marked.',
  '2. Field order is fixed: t, forms, kind, def, more, rel, basis. Omit optional fields with no content.',
  '3. When there is no word to explain, write no block at all rather than an empty array.',
  '',
  'Example: the user asks "We are rolling out the canary release next week, but QA has not finished testing. How should I tell my lead?" and the answer mentions "rollback" and "use case" for the first time ("canary", "QA" are the user\'s own words, so they are not marked):',
  '<dsh:glossary>',
  '[',
  '  {"t":"rollback","forms":["rollback"],"kind":"行话","def":"Restoring the online service to the previous stable version when the new version turns out to be broken","more":"It usually relies on pre-agreed triggers: when the crash rate or a core metric drops past a threshold, roll back automatically or by hand, so a bad canary release only costs a little.","rel":["canary release","full rollout"],"basis":"通用"},',
  '  {"t":"test case","forms":["use case"],"kind":"专业术语","def":"One concrete test step and its expected result, used to check that a feature behaves correctly","rel":["QA","smoke test"],"basis":"通用"}',
  ']',
  '',
  'Anti-patterns (do not do these): a circular definition; marking an everyday word; inventing an internal-name meaning from the surface form; `forms` that differs from the answer in case; a definition that introduces another unexplained term; any text after the glossary block.',
]

/** Fill the numeric placeholders without touching any other braces. */
function fill(text, settings) {
  return text
    .split('{max_terms}').join(String(settings.maxTerms))
    .split('{def_max}').join(String(settings.defMax))
    .split('{more_max}').join(String(settings.moreMax))
}

/**
 * Build the full model-facing section for one configuration.
 * @param {{ language?: string, maxTerms?: number, defMax?: number, moreMax?: number, strictness?: string }} [settings]
 * @returns {string}
 */
export function buildPromptSection(settings = {}) {
  const source = isRecord(settings) ? settings : {}
  const normalized = normalizeConfig({
    language: source.language,
    max_terms: source.maxTerms,
    def_max: source.defMax,
    more_max: source.moreMax,
    strictness: source.strictness,
  })
  const base = fill((normalized.promptLanguage === 'en' ? EN_RULES : ZH_RULES).join('\n'), normalized)
  return base
    .split('@@TRIGGER@@').join(fill(buildTriggerSection(normalized), normalized))
    .split('@@SELECTION@@').join(fill(buildSelectionSection(normalized), normalized))
}

/** Re-exported so the Host can normalize without importing two modules. */
export { clampInt }
