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

/** 最小 Conversation 位置（只透传，不读字段）。 */
export interface CardLocation {
  readonly kind: string
}

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
    if (anchor === null || state.cards.length === 0) return null
    return {
      key: context.key,
      kind: 'campus-cards',
      id: context.id,
      target: 'chat',
      anchorSeq: anchor,
      location: context.start?.location ?? { kind: 'unresolved' },
      visibility: 'visible',
      data: { cards: state.cards },
    }
  },
}
