/**
 * dsh-campus-hunt · 回答区岗位卡片会话节点（v0.1.1，client 半场）。
 *
 * 卡片原挂工具调用行（v0.1）；DSH 显示模式 compact（默认）下回合内工具
 * 调用行被折进进程 disclosure，默认不可见。v0.1.1 迁移到
 * 「正式回答区」：注册自定义会话节点 campus-cards（数据面
 * `ctx.uiConversation.events.register` + 渲染面 keyed 槽
 * `conversation.chat.node` key='campus-cards'），锚定在回合末尾——compact /
 * normal 双模式可见（anchor ≥ answerAnchorSeq 不是 process member，host
 * ChatNodeSeat 折叠判据）。
 *
 * 锚定口径（对齐 host DSH 0.1.2-rc.1 turn-tail / turn-process）：
 * - 有文本答案：S + 0.075 —— S = 末条含非空文本的 append-surface
 *   assistant/message 的 seq（host turn-process 的 answerAnchorSeq = S，折叠
 *   窗 [processStartSeq, S) 不含 S+0.075）；S+0.075 恰在答案（S）与 turn
 *   footer 操作行（S+0.1）之间（max-tokens 通知 S+0.05 更靠上）。
 * - 无文本答案：endSeq - 0.05（endSeq = turn/end 的 seq；无文本答案的回合
 *   answerAnchorSeq = null，本来就不折叠）。
 * - 流式期间 buildViewNode 不产出（turn/end 未到达）→ 卡片在回合结束后才
 *   出现（publication 仿 turn-tail：turn/end 'immediate'，其余 'none'）。
 *
 * 数据面：只收 4 个 campus 工具（campus_job_search / campus_job_detail /
 * campus_schedule / job_track）已落定（isError !== true、append-surface）的
 * tool/result。block 按事件直取构造（{ kind:'tool-result', callId, call,
 * content, isError:false, meta?, error? }，与 host tool.ts rootResult 同
 * 口径——call 取自配对 tool/call，使 JobCards GenericRow 的 args 行完整），
 * 复用 JobCards.parseCard——卡片组件本体零改动。
 *
 * v0.1.3（PTC 工具呈现兼容）：host 以 presentAs('ptc') 呈现工具时顶层只暴露
 * run_code，4 个 campus 工具被 pack 成 run_code 内的 tool/ptc-dispatch，
 * campusCardsDefinition 的 match（只认 native tool/call | tool/result）零命中
 * → 无卡。新增卫星 definition campusCardsPtcDefinition（state-only、无
 * target、不物化 view node）：一个 run_code 根调用 = 一个 context（id=callId），
 * 收集其 pack 的 campus 卡片（到达序），经 step 作用域发布 Location 数据
 * （key 'campus-cards-ptc'），由 per-turn definition 在 turn/end 聚合：
 * cards = native state.cards ∪ step location 卡片（并序 = native 在前 + PTC
 * 按 step 序；按 callId 去重；PTC content ?? [] 归一）。native 回合（无
 * run_code → 无卫星数据）引用不变，行为字节不变。native 呈现（顶层
 * tool/call + tool/result 带 data.name）仍走 campusCardsDefinition。
 *
 * 类型自写口径：本插件不安装 harness client 包（dsh-client-ui-*），下面所有
 * 会话节点 / 会话事件类型均手写最小结构类型（与 index.tsx 的 slots / sessions
 * 同口径），宿主运行时实现注入；本文件纯逻辑（无 React、无副作用），可直接
 * 单测（test/client-campus-cards.test.ts）。
 */
import type { ToolResultNodeLike } from './JobCards.tsx'

/** 产卡片的 4 个 campus 工具（host 工具 wire 名）。 */
export const CAMPUS_CARD_TOOLS: ReadonlySet<string> = new Set([
  'campus_job_search',
  'campus_job_detail',
  'campus_schedule',
  'job_track',
])

// ─────────────────────────────────────────────────────────────────────────────
// 手写最小 wire 类型（会话事件；wire = core/session types.ts）
// ─────────────────────────────────────────────────────────────────────────────

/** 最小会话事件信封（本插件关心的子集；wire seq 为 branded number，结构上即 number）。 */
export interface CardEvent {
  readonly type: string
  readonly seq: number
  readonly time: number
  readonly data: unknown
  /** append-surface 标记（仅 surface 事件携带：'append' | 'replace'）。 */
  readonly surfaceOp?: unknown
}

/** 回合位置（host TurnLocation 子集）：step 列表（数据经 step 位置读）。 */
export interface CardTurnLocation {
  readonly steps: readonly CardStepLocation[]
}

/**
 * step 位置（host StepLocation 子集）：只暴露 Location 数据 store 的读面。
 * get 用方法语法（bivariant：host 具体 store 结构可赋值进来）+ string 键 /
 * unknown 值（wire 口径，读方按键收窄——host 数据 map 的键域本插件不可见）。
 */
export interface CardStepLocation {
  readonly data: {
    get(key: string): unknown
  }
}

/**
 * 最小 Conversation 位置（host ConversationLocation 四元 union：
 * session / unresolved / turn / step）。turn / step 位置对象可选：mini
 * 引擎可只传 kind；宿主具体位置（带完整 turn / step 对象）结构可赋值。
 */
export type CardLocation =
  | { readonly kind: 'session' }
  | { readonly kind: 'unresolved' }
  | { readonly kind: 'turn'; readonly turn?: CardTurnLocation }
  | { readonly kind: 'step'; readonly turn?: CardTurnLocation; readonly step?: CardStepLocation }

/** 一条 match 记录（事件 + 角色 + 位置）。 */
export interface CardMatch {
  readonly event: CardEvent
  readonly role: 'start' | 'update'
  readonly location: CardLocation
}

// ─────────────────────────────────────────────────────────────────────────────
// 状态与节点数据
// ─────────────────────────────────────────────────────────────────────────────

/** 一个回合内已记录的 tool/call（仅 4 个 campus 工具）。 */
export interface CampusCardCall {
  readonly tool: string
  readonly argsRaw: string
}

/** 一张已落定卡片（callId 配对 tool/call，block 按 tool/result 事件直取构造）。 */
export interface CampusCardEntry {
  readonly callId: string
  readonly tool: string
  readonly block: ToolResultNodeLike
}

/** 回合级累积状态（fold 纯函数；重放 = 新事件流同结果）。 */
export interface CampusCardsState {
  readonly turn: number
  readonly calls: ReadonlyMap<string, CampusCardCall>
  readonly cards: readonly CampusCardEntry[]
  /** S：末条含非空文本的 append-surface assistant/message 的 seq（undefined = 无文本答案）。 */
  readonly textSeq: number | undefined
  /** turn/end 的 seq（undefined = 回合未结束）。 */
  readonly endSeq: number | undefined
}

/** 卡片节点数据（渲染面只读这份）。 */
export interface CampusCardsNodeData {
  readonly cards: readonly CampusCardEntry[]
}

/** campus-cards Chat 节点（host ChatNode 子集，多余字段 wire 上被忽略）。 */
export interface CampusCardsChatNode {
  readonly key: string
  readonly kind: 'campus-cards'
  readonly id: string
  readonly target: 'chat'
  readonly anchorSeq: number
  readonly location: CardLocation
  readonly visibility: 'visible'
  readonly data: CampusCardsNodeData
}

/** 最小上下文切片（只读 key / id / start / matches / state）。 */
export interface CampusCardsContext {
  readonly key: string
  readonly id: string
  readonly kind: string
  readonly start?: CardMatch
  readonly matches: readonly CardMatch[]
  readonly state?: CampusCardsState
}

/**
 * conversation 节点 definition（host ConversationNodeDefinition 子集；结构
 * 兼容口径：参数类型均为 host 类型的超类型，返回值均为 host 类型的子集）。
 */
export interface CampusCardsDefinition {
  readonly kind: 'campus-cards'
  readonly target: 'chat'
  readonly match: (event: CardEvent) => { id: string; role: 'start' | 'update' } | null
  readonly start: (context: CampusCardsContext, match: CardMatch) => CampusCardsState
  readonly update: (context: CampusCardsContext & { state: CampusCardsState }, match: CardMatch) => CampusCardsState
  readonly publication: (match: CardMatch) => 'none' | 'immediate'
  readonly buildViewNode: (context: CampusCardsContext) => CampusCardsChatNode | null
}

// ─────────────────────────────────────────────────────────────────────────────
// 结构读取 helper（wire 值不可信，逐项校验；畸形字段按缺席处理）
// ─────────────────────────────────────────────────────────────────────────────

function asRecord(v: unknown): Record<string, unknown> | null {
  return v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null
}

/** 有限非负整数（与 host common.ts coordinate 同口径）。 */
function safeInt(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 ? v : undefined
}

/** 事件 data.turn（match / update 的唯一 scope 维度）。 */
function eventTurn(event: CardEvent): number | undefined {
  return safeInt(asRecord(event.data)?.turn)
}

/** assistant/message 是否含非空文本（host turn-tail hasTextAssistant 同口径）。 */
function messageHasText(event: CardEvent): boolean {
  const message = asRecord(event.data)?.message
  const content = asRecord(message)?.content
  if (!Array.isArray(content)) return false
  return content.some(block => {
    const r = asRecord(block)
    return r !== null && r.type === 'text' && typeof r.text === 'string' && r.text.trim() !== ''
  })
}

/**
 * 锚定 seq（host turn-tail / turn-process 对齐）：有文本答案 S+0.075，
 * 否则 endSeq-0.05；回合未结束（endSeq undefined）→ null（buildViewNode
 * 不产出）。
 */
export function cardAnchorSeq(state: CampusCardsState): number | null {
  if (state.endSeq === undefined) return null
  return state.textSeq !== undefined ? state.textSeq + 0.075 : state.endSeq - 0.05
}

/**
 * 从 turn 位置读 PTC 卫星卡片（v0.1.3 聚合读取路径）：buildViewNode 只在
 * endSeq 已定义时产出 → 末 match 必为 turn/end → 其 location（kind 'turn'）
 * 的 steps 为当前全量；按 step 序 data.get('campus-cards-ptc') → { cards }；
 * 缺席 / 畸形（非对象、cards 非数组）按无处理。
 */
function ptcCardsFromTurnLocation(location: CardLocation): CampusPtcCardBlock[] {
  if (location.kind !== 'turn' || location.turn === undefined) return []
  const out: CampusPtcCardBlock[] = []
  for (const step of location.turn.steps) {
    const value = asRecord(step.data.get('campus-cards-ptc'))
    if (value === null) continue
    if (Array.isArray(value.cards)) out.push(...(value.cards as CampusPtcCardBlock[]))
  }
  return out
}

/** 卫星 pack 卡片 → JobCards entry（v0.1.3）：content ?? [] 归一；argsRaw 透传（fold 已 '' 兜底）。 */
function ptcBlockToEntry(block: CampusPtcCardBlock): CampusCardEntry {
  return {
    callId: block.callId,
    tool: block.call.name,
    block: {
      kind: 'tool-result',
      callId: block.callId,
      call: { name: block.call.name, argsRaw: block.call.argsRaw },
      content: (block.content ?? []) as ToolResultNodeLike['content'],
      isError: false,
    },
  }
}

/**
 * cards = native state.cards ∪ PTC 卫星 step location 卡片（v0.1.3）：并序
 * = native 在前 + PTC 按 step 序；按 callId 去重（'both' 模式两 id 域天然
 * 不相交，去重是防御）；无 PTC 卡片 → 引用返回 state.cards（native 回合
 * 字节不变）。
 */
function aggregateTurnCards(state: CampusCardsState, matches: readonly CardMatch[]): readonly CampusCardEntry[] {
  const last = matches[matches.length - 1]
  if (last === undefined) return state.cards
  const ptc = ptcCardsFromTurnLocation(last.location)
  if (ptc.length === 0) return state.cards
  const out: CampusCardEntry[] = [...state.cards]
  const seen = new Set<string>(state.cards.map(card => card.callId))
  for (const block of ptc) {
    if (block.callId === '' || seen.has(block.callId)) continue
    seen.add(block.callId)
    out.push(ptcBlockToEntry(block))
  }
  return out
}

// ─────────────────────────────────────────────────────────────────────────────
// definition 本体
// ─────────────────────────────────────────────────────────────────────────────

export const campusCardsDefinition: CampusCardsDefinition = {
  kind: 'campus-cards',
  target: 'chat',
  match: (event) => {
    const turn = eventTurn(event)
    if (turn === undefined) return null
    if (event.type === 'turn/start') return { id: String(turn), role: 'start' }
    if (event.type === 'tool/call') return { id: String(turn), role: 'update' }
    if (event.type === 'tool/result') {
      return event.surfaceOp === 'append' ? { id: String(turn), role: 'update' } : null
    }
    if (event.type === 'assistant/message') {
      return event.surfaceOp === 'append' && messageHasText(event)
        ? { id: String(turn), role: 'update' }
        : null
    }
    if (event.type === 'turn/end') return { id: String(turn), role: 'update' }
    return null
  },
  start: (_context, match) => {
    if (match.event.type !== 'turn/start') throw new Error('campus-cards start requires turn/start')
    const turn = eventTurn(match.event)
    if (turn === undefined) throw new Error('campus-cards start: malformed turn')
    return {
      turn,
      calls: new Map(),
      cards: [],
      textSeq: undefined,
      endSeq: undefined,
    }
  },
  update: (context, match) => {
    const event = match.event
    const state = context.state
    // 引擎按 id = String(turn) 路由；此处再防一层跨回合事件混入。
    const turn = eventTurn(event)
    if (turn === undefined || turn !== state.turn) return state

    if (event.type === 'tool/call') {
      const d = asRecord(event.data)
      if (d === null) return state
      const name = typeof d.name === 'string' ? d.name : ''
      const callId = typeof d.callId === 'string' && d.callId !== '' ? d.callId : ''
      if (name === '' || callId === '' || !CAMPUS_CARD_TOOLS.has(name)) return state
      const calls = new Map(state.calls)
      calls.set(callId, { tool: name, argsRaw: typeof d.arguments === 'string' ? d.arguments : '' })
      return { ...state, calls }
    }

    if (event.type === 'tool/result') {
      const d = asRecord(event.data)
      const message = d === null ? null : asRecord(d.message)
      const source = message === null ? null : asRecord(message.source)
      const callId = source !== null && typeof source.callId === 'string' ? source.callId : ''
      const call = callId === '' ? undefined : state.calls.get(callId)
      if (call === undefined) return state
      const results = message !== null && Array.isArray(message.content) ? message.content : []
      const result = asRecord(results[0])
      if (result !== null && result.isError === true) return state
      const content = result !== null && Array.isArray(result.content) ? result.content : []
      const block: ToolResultNodeLike = {
        kind: 'tool-result',
        callId,
        // 取自配对 tool/call（host rootResult 同口径）：GenericRow 的 args 行需要它。
        call: { name: call.tool, argsRaw: call.argsRaw },
        content: content as ToolResultNodeLike['content'],
        isError: false,
      }
      if (d !== null && d.meta !== undefined) block.meta = d.meta
      if (d !== null && d.error !== undefined) {
        block.error = d.error as ToolResultNodeLike['error']
      }
      return { ...state, cards: [...state.cards, { callId, tool: call.tool, block }] }
    }

    if (event.type === 'assistant/message') {
      return { ...state, textSeq: event.seq }
    }

    if (event.type === 'turn/end') {
      return { ...state, endSeq: event.seq }
    }

    return state
  },
  publication: (match) => (match.event.type === 'turn/end' ? 'immediate' : 'none'),
  buildViewNode: (context) => {
    const state = context.state
    if (state === undefined) return null
    const anchor = cardAnchorSeq(state)
    if (anchor === null) return null
    // v0.1.3 聚合：native ∪ PTC 卫星 step location 卡片（末 match 必为
    // turn/end，其 location.steps 为当前全量）。
    const cards = aggregateTurnCards(state, context.matches)
    if (cards.length === 0) return null
    return {
      key: context.key,
      kind: 'campus-cards',
      id: context.id,
      target: 'chat',
      anchorSeq: anchor,
      location: context.start?.location ?? { kind: 'unresolved' },
      visibility: 'visible',
      data: { cards },
    }
  },
}

// ─────────────────────────────────────────────────────────────────────────────
// PTC 卫星 definition（v0.1.3；state-only，无 target，不物化 view node）
//
// host 0.1.5-rc.2 机制口径（对照 checkout）：
// - 一个 context id 只允许一个 start → 卫星以 run_code 根调用 callId 为 id
//   （不能并入 per-turn context，id=turn 会重复 start）。
// - buildLocationData 由引擎强制 data.key === context.kind、turn / step 为
//   有效非负整数；previous 未变须 identity 返回（引擎据此跳过变更）。
// - Location 数据 owner 按 (turn, step, key) 唯一 → 必须发 step 作用域
//   （每 step 至多一个 run_code 根调用 → 每 step 一个卫星，天然不撞；turn
//   作用域下同回合多次 run_code 会撞）。
// - flush 事务序：applyDirtyLocationData 先于 buildTargetUpserts → 同一次
//   turn/end flush 内 per-turn 节点可读卫星刚装的 step 数据。
// ─────────────────────────────────────────────────────────────────────────────

/** PTC pack 卡片 block（host tool.ts childResult 口径，本插件所需字段子集）。 */
export interface CampusPtcCardBlock {
  readonly kind: 'tool-result'
  /** 子调用 id（卡片去重键）。 */
  readonly callId: string
  /** name = dispatch 工具名；argsRaw = JSON.stringify(dispatch.arguments)。 */
  readonly call: { readonly name: string; readonly argsRaw: string }
  /** dispatch 事件 content 直取（可缺席——不做 ?? [] 兜底，消费方聚合时归一）。 */
  readonly content: unknown
  /** 恒 false：isError === true 的 dispatch 在 fold 时跳过。 */
  readonly isError: false
}

/** 卫星 context 状态（一个 run_code 根调用 = 一个 context；fold 纯、可重放）。 */
export interface CampusPtcState {
  /** 取自 run_code tool/call 的 data.turn（畸形 → undefined，不发布）。 */
  readonly turn: number | undefined
  /** 取自 run_code tool/call 的 data.step（畸形 → undefined，不发布）。 */
  readonly step: number | undefined
  /** pack 卡片，按 dispatch 到达序。 */
  readonly cards: readonly CampusPtcCardBlock[]
}

/** Location 数据值（key 'campus-cards-ptc' 下发布）。 */
export interface CampusPtcStepLocationData {
  readonly cards: readonly CampusPtcCardBlock[]
}

/** Location 数据记录（host ConversationLocationData 泛型形态子集；step 分支）。 */
export interface CampusPtcStepLocationDataRecord {
  readonly kind: 'step'
  readonly turn: number
  readonly step: number
  readonly key: 'campus-cards-ptc'
  readonly value: CampusPtcStepLocationData
}

/** buildLocationData 的 previous 参（手写超类型：host 任意已注册记录结构可赋值）。 */
export interface CampusPtcLocationDataPrevious {
  readonly kind: string
  readonly turn: number
  readonly step?: number
  readonly key: string
  readonly value: unknown
}

/** 卫星最小 context 切片（与 CampusCardsContext 同口径）。 */
export interface CampusPtcContext {
  readonly key: string
  readonly id: string
  readonly kind: 'campus-cards-ptc'
  readonly start?: CardMatch
  readonly matches: readonly CardMatch[]
  readonly state?: CampusPtcState
}

/**
 * PTC 卫星 definition（host ConversationNodeDefinition 子集；无 target =
 * state-only Context，无 withdrawal 约束）。结构兼容口径同
 * CampusCardsDefinition：参数类型均为 host 类型的超类型，返回值均为 host
 * 类型的子集。
 */
export interface CampusPtcDefinition {
  readonly kind: 'campus-cards-ptc'
  readonly match: (event: CardEvent) => { id: string; role: 'start' | 'update' } | null
  readonly start: (context: CampusPtcContext, match: CardMatch) => CampusPtcState
  readonly update: (context: CampusPtcContext & { state: CampusPtcState }, match: CardMatch) => CampusPtcState
  readonly publication: (match: CardMatch) => 'none' | 'immediate'
  readonly buildLocationData: (
    context: CampusPtcContext,
    scope: 'step' | 'turn',
    previous: CampusPtcLocationDataPrevious | null,
  ) => CampusPtcStepLocationDataRecord | null
}

export const campusCardsPtcDefinition: CampusPtcDefinition = {
  kind: 'campus-cards-ptc',
  match: (event) => {
    // 只认两类事件：run_code 根调用（start）与 4 个 campus 工具的 pack
    // dispatch（update）。不碰 native tool/call | tool/result（per-turn
    // definition 的职责）；不 match tool/ptc-dispatch-start（dispatch 单事件
    // 已含完整 call + result，无信息损失）；不 match run_code 根的
    // tool/result（卡片在 dispatch 到达时已完整）。
    if (event.type === 'tool/call') {
      const d = asRecord(event.data)
      if (d === null) return null
      if (typeof d.name !== 'string' || d.name !== 'run_code') return null
      const callId = typeof d.callId === 'string' && d.callId !== '' ? d.callId : ''
      if (callId === '') return null
      return { id: callId, role: 'start' }
    }
    if (event.type === 'tool/ptc-dispatch') {
      const d = asRecord(event.data)
      if (d === null) return null
      const name = typeof d.name === 'string' ? d.name : ''
      if (!CAMPUS_CARD_TOOLS.has(name)) return null
      const rootCallId = typeof d.rootCallId === 'string' && d.rootCallId !== '' ? d.rootCallId : ''
      if (rootCallId === '') return null
      return { id: rootCallId, role: 'update' }
    }
    return null
  },
  start: (_context, match) => {
    if (match.event.type !== 'tool/call') throw new Error('campus-cards-ptc start requires tool/call')
    const d = asRecord(match.event.data)
    // run_code tool/call 自带 turn/step；畸形 → undefined（buildLocationData 不发布）。
    return {
      turn: d === null ? undefined : safeInt(d.turn),
      step: d === null ? undefined : safeInt(d.step),
      cards: [],
    }
  },
  update: (context, match) => {
    const event = match.event
    const state = context.state
    if (event.type !== 'tool/ptc-dispatch') return state
    const d = asRecord(event.data)
    if (d === null) return state
    // 错误 dispatch 不产卡（block 恒 isError:false，直接跳过）。
    if (d.isError === true) return state
    const subCallId = typeof d.subCallId === 'string' && d.subCallId !== '' ? d.subCallId : ''
    if (subCallId === '') return state
    const name = typeof d.name === 'string' ? d.name : ''
    // match 已过滤；此处再防一层非 campus dispatch 混入。
    if (!CAMPUS_CARD_TOOLS.has(name)) return state
    const block: CampusPtcCardBlock = {
      kind: 'tool-result',
      callId: subCallId,
      call: {
        name,
        // wire 不可信：arguments 缺席时 JSON.stringify 返回 undefined → 空串。
        argsRaw: JSON.stringify(d.arguments) ?? '',
      },
      // content 直取 dispatch（无 ?? [] 兜底）。
      content: d.content,
      isError: false,
    }
    return { ...state, cards: [...state.cards, block] }
  },
  // 卫星无 view node；step 数据只被 per-turn 节点在 turn/end flush 消费
  // （同 flush 内先装 location 数据再 build upsert）→ 无需立即 flush。
  publication: () => 'none',
  buildLocationData: (context, scope, previous) => {
    if (scope !== 'step') return null
    const state = context.state
    if (state === undefined || state.cards.length === 0) return null
    // start 畸形（turn / step 缺席）→ 引擎会拒非法坐标，不发布。
    if (state.turn === undefined || state.step === undefined) return null
    if (previous !== null && previous.kind === 'step' && previous.key === 'campus-cards-ptc') {
      const value = asRecord(previous.value)
      // cards 引用未变 → identity 返回 previous（引擎跳过变更）。
      if (value !== null && value.cards === state.cards) return previous as CampusPtcStepLocationDataRecord
    }
    return {
      kind: 'step',
      turn: state.turn,
      step: state.step,
      key: 'campus-cards-ptc',
      value: { cards: state.cards },
    }
  },
}
