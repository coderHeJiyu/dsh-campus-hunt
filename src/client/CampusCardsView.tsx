/**
 * dsh-campus-hunt · 回答区卡片尾组件（v0.1.1，client 半场）。
 *
 * `conversation.chat.node` keyed 槽（key='campus-cards'）的渲染面：host 传
 * 本回合的 Chat 节点（node.data.cards = 4 个 campus 工具已落定卡片，见
 * campus-cards.ts）+ Chat owner 面；本组件逐项渲染 JobCards（组件本体零
 * 改动：parseCard 分支 / 三 tab / 逐项校验 / GenericRow / CrashRow 全部
 * 复用），sendPrompt / loadWorkspaceFile（inject 面产物，v0.1.3 PTC 文件
 * 分支的会话 workspace 文件加载器）与 openFile / cwd 原样透传。
 *
 * 永不白屏：node 缺席 / cards 空 → 渲染 null（不产出行）；单项数据畸形或
 * 渲染 throw → 该项兜底最小 generic 行（JobCards 自带 try/catch，本层是
 * 外层防御——单项崩溃不连坐整列）。
 *
 * 样式遵循 DSH 外部插件惯例：内联样式、内联中文、透明底、无 locale。
 */
import type { ReactElement } from 'react'
import { JobCards } from './JobCards.tsx'
import type { CampusCardEntry, CampusCardsNodeData } from './campus-cards.ts'

/** 最小 host 节点切片（只读 data）。 */
export interface CampusCardsViewProps {
  readonly node: { data: CampusCardsNodeData }
  /** 动作 prompt 通道（inject 面产物，见 index.tsx）；缺失时动作按钮禁用。 */
  readonly sendPrompt?: (text: string) => void
  /** v0.1.3 PTC 文件分支：会话 workspace 文件加载器（inject 面产物，见 index.tsx）；缺席时卡片不进文件分支。 */
  readonly loadWorkspaceFile?: (path: string) => Promise<string | null>
  /** host openFile（框架必传；本卡片不用，但 JobCardsProps 要求）。 */
  readonly openFile?: (path: string) => void
  /** host cwd（本卡片不用；透传）。 */
  readonly cwd?: string
}

const wrapStyle = { display: 'flex', flexDirection: 'column' as const, gap: 10 }
const crashStyle = {
  border: '1px solid rgba(255,255,255,0.14)',
  borderRadius: 8,
  padding: '10px 12px',
  fontSize: 12,
  color: '#d15454',
}

export function CampusCardsView(props: CampusCardsViewProps): ReactElement | null {
  const cards = props.node?.data?.cards
  if (cards === undefined || cards.length === 0) return null
  // JobCards 无打开文件动作，但 props 要求；host 恒传 openFile，缺省时 no-op。
  const openFile = props.openFile ?? (() => { /* 无打开文件动作 */ })
  return (
    <div style={wrapStyle}>
      {cards.map((card, index) => (
        <CardItem
          key={`${card?.callId ?? 'unknown'}#${index}`}
          card={card}
          sendPrompt={props.sendPrompt}
          loadWorkspaceFile={props.loadWorkspaceFile}
          openFile={openFile}
          cwd={props.cwd}
        />
      ))}
    </div>
  )
}

/** 单项卡片：JobCards 原样透传 + 外层 try/catch 兜底（永不白屏）。 */
function CardItem(props: {
  /** wire 数据不可信：null / undefined 条目按崩溃兜底处理（不连坐整列）。 */
  card: CampusCardEntry | null | undefined
  sendPrompt?: (text: string) => void
  loadWorkspaceFile?: (path: string) => Promise<string | null>
  openFile: (path: string) => void
  cwd?: string
}): ReactElement {
  try {
    const card = props.card
    if (card === null || card === undefined) throw new Error('卡片数据缺失')
    return (
      <JobCards
        callId={card.callId}
        toolName={card.tool}
        block={card.block}
        openFile={props.openFile}
        cwd={props.cwd}
        sendPrompt={props.sendPrompt}
        loadWorkspaceFile={props.loadWorkspaceFile}
      />
    )
  } catch (error) {
    return <CrashFallback toolName={props.card?.tool ?? 'unknown'} error={error} />
  }
}

/** 单项崩溃兜底：最小 generic 行（外层防御；JobCards 内部已有同款 catch）。 */
function CrashFallback(props: { toolName: string; error: unknown }): ReactElement {
  const msg = props.error instanceof Error ? props.error.message : String(props.error)
  return (
    <div style={crashStyle}>
      卡片渲染失败（{props.toolName}）：{msg}
    </div>
  )
}
