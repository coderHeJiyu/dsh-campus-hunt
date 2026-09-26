/**
 * dsh-campus-hunt · client 半场入口（v0.1 / v0.1.3 / v0.1.4）。
 *
 * v0.1.4（0.1.7 client 契约）：回答区卡片迁移到 turn-tail 槽——数据面注册
 * per-turn 会话节点 definition（不再物化 chat 节点：经 buildLocationData
 * 发布 turn 作用域 Location 数据 key 'campus-cards'，见 campus-cards.ts）
 * + PTC 卫星（v0.1.3，零改动）；渲染面注册 session-scope 槽
 * conversation.chat.turnTail（ctx.slots.inject + register，host
 * ui-deliverables 先例），CampusTail 从 owner 的 turn（TurnLocation）读
 * turn.data.get('campus-cards')：空 → null，非空 → 复用 JobCards 逐项渲染
 * （JobCards 组件本体零改动，4 个工具键 campus_job_search /
 * campus_job_detail / campus_schedule / job_track 的已落定结果同口径汇入
 * 一列尾卡，卡片分支由 block.meta.card 或 content 规范值 JSON 决定）。
 * 卡片在回合结束后于答案下方 footer 区常显，不被「已完成分析 / 用时 xx
 * 秒」操作行折叠；原 chat 节点 + 锚点口径（cardAnchorSeq / 0.075 /
 * endSeq-0.05）随 buildViewNode 一并移除。
 *
 * v0.1.3：卡片支持 PTC 工具呈现——host 以 presentAs('ptc') 呈现工具时
 * 顶层只暴露 run_code，4 个 campus 工具被 pack 成 run_code 内的
 * tool/ptc-dispatch；数据面双注册（per-turn + state-only 卫星
 * campusCardsPtcDefinition，见 campus-cards.ts）：卫星经 step 作用域
 * 发布 Location 数据，per-turn 在 turn/end 聚合。native 呈现行为
 * 不变。渲染面 PTC 文件分支：inject 面成员 loadWorkspaceFile(path)
 * 经 workspace-files remote 面读会话 workspace 文件（原生字节 → UTF-8 文本），
 * PTC 呈现 meta 缺席时卡片活读 jobs.json / track.json / schedule.json 重建
 * 规范值并复用卡片体（见 JobCards.tsx）；remote 面缺席 / 读取失败 → null →
 * 回退 generic 行，native 不受影响。
 *
 * v0.1：另在 `settings.section` 槽注册设置页卡片（CampusHuntSection，
 * 见 settings.tsx）——四卡 UI（画像 / 简历 / 专场 / 采集红线），读经
 * form 快照、写经 setField / resetField。
 *
 * v0.1.4（0.1.7 client 契约）：设置页迁移到 ConfigForms——inject
 * 面移除 settingsScope、新增 configForms；注册改 ctx.effect +
 * configForms.whileServed([NS], ...)（namespace 未服务零注册、服务后注册、
 * 撤了自动回滚，mirror 驱动；0.1.7 ui-settings-web-search 先例），register
 * spec 的 label 改函数形态。setField / resetField 薄封装 form.set /
 * form.unset（Promise<boolean>：true 接受 / false 拒绝或跳写（form 内建
 * latest-write 恢复）；transport 失败 reject 归一 false，按钮可重试）；
 * v0.1 写编排（writeTimings 导出 / inFlightWrites / pendingWireOps /
 * waitForValue / raceTimeout / 四态 ok-rejected-stale-timeout）全部删除——
 * 连写保序 + revision fence + 失败镜像重读由 form 内建写队列承担。
 *
 * 先例：DSH 外部插件形态（模块级 inject 数组 + 逐个 register、
 * `ctx.slots === undefined` 守卫、内联中文与内联样式、无
 * locale——外部插件不依赖 harness 的 locale 基建）。
 *
 * 动作通道：回答区卡片注册（conversation.chat.turnTail，session scope）
 * 携带 `inject` 面——框架解析的 sessionId 作为工厂首参（session scope 的
 * InjectParams = [sessionId]；renderer 按声明派生位置参），工厂返回
 * `{ sendPrompt(text) }`：闭包捕获 sessions 服务与 sessionId，动作经
 * `binding(sessionId).session.prompt([{type:'text',text}],'queue')` 入队。
 * 组件侧 inject 面成员 verbatim 进 props（InjectFace 合成），故
 * JobCards 只收 `sendPrompt?: (text) => void`。两场景区分：无 inject
 * 面（非框架渲染）→ props 无 sendPrompt → 按钮禁用；框架渲染但
 * sessions 面 / binding 不可用 → sendPrompt 仍是函数、点击静默 no-op。
 *
 * 类型说明：@deepseek-ai/cordis 的 Context 不声明 slots / configForms /
 * uiConversation（那是 dsh-client 侧的声明合并，本插件未依赖这些包），
 * 此处本地合并最小面（slots 只用 inject / register 两个方法、返回值形态
 * 为 disposer；configForms 只用 get / whileServed；uiConversation 只用
 * events.register）；sessions 服务同样不装 dsh-api-session-controller，
 * 按 wire 形态内联最小结构类型。ConfigForm（dsh-client-ui-settings 提供）
 * 同样按 wire 形态自写最小结构类型（见 settings.tsx）。运行时实现均由
 * 宿主注入。
 */
import type { ReactElement } from 'react'
import type { Context } from '@deepseek-ai/cordis'

import {
  campusCardsDefinition,
  campusCardsPtcDefinition,
  type CampusCardEntry,
  type CampusCardsDefinition,
  type CampusPtcDefinition,
} from './campus-cards.ts'
import { JobCards } from './JobCards.tsx'
import { CampusHuntSection } from './settings.tsx'
import type { ConfigFormLike, SettingsSectionInject } from './settings.tsx'
import { NS } from '../ns.ts'
import type { Config } from '../config.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** client 侧 slots 服务（宿主注入；非 client 语境下为 undefined）。 */
    slots?: {
      /** 注册贡献工厂；返回 disposer（撤回时移除贡献，whileServed 回滚依赖它）。 */
      inject(name: string, contribution: () => (() => void) | Iterable<() => void>): () => void
      register(
        spec: {
          name: string
          key?: string
          id?: string
          order?: number
          /** 0.1.7 renderer register spec：label 为函数形态。 */
          label?: () => string
          /** 0.1.7 register spec 的字典 namespace（置 t 座）；外部插件不依赖 locale 基建，仅自型保真。 */
          locale?: string
          /**
           * session-scope 槽（conversation.chat.turnTail）：框架把解析出的
           * sessionId 作为工厂首参；root-scope 槽（settings.section）：
           * 零参工厂。
           */
          inject?: ((sessionId: string) => { sendPrompt: (text: string) => void; loadWorkspaceFile: (path: string) => Promise<string | null> }) | (() => SettingsSectionInject)
        },
        component: unknown,
      ): () => void
    }
    /** ConfigForms 服务（宿主 ui-settings 提供，0.1.7 web 核心常驻；非 UI 宿主缺席）。 */
    configForms?: {
      /** 一个 entry 的 form 单例（同 entry 共享一 form；读写皆经它）。 */
      get<T>(entryId: string): ConfigFormLike<T>
      /** mirror 驱动：任一 namespace 被服务时 register，全撤时回滚。 */
      whileServed(
        namespaces: readonly string[],
        register: (served: ReadonlySet<string>) => () => void,
      ): () => void
    }
    /**
     * 会话节点事件面（宿主 ui-conversation 提供，dsh-client-ui-conversation
     * 的 `ctx.uiConversation`）：`events.register(definition)` 注册
     * conversation 节点 definition（回答区卡片的数据面，见 campus-cards.ts；
     * v0.1.3 双注册：per-turn turn 作用域数据 + PTC 卫星）。缺席（非 UI
     * 宿主）时跳过注册，同 slots 守卫口径。
     */
    uiConversation?: {
      events: {
        register(definition: CampusCardsDefinition | CampusPtcDefinition): () => void
      }
    }
  }
}

/** prompt 文本 part（对齐 dsh-api-session-controller 的 PromptContentPart text 分支）。 */
interface PromptTextPart {
  type: 'text'
  text: string
}

/**
 * 最小 sessions 服务面（ISessions 子集，本插件不装 dsh-api-session-controller）：
 * 只取动作需要的 binding → session → prompt 链。
 */
interface SessionsFace {
  binding(id: string): {
    session: {
      prompt(content: PromptTextPart[], mode: 'queue'): Promise<unknown>
    }
  } | undefined
}

/** 最小 remote 结果（生成 remote 面的 RemoteResult；本插件不装 dsh-api-workspace-files，同 SessionsFace 自写口径）。 */
type RemoteResultLike<T> = { ok: true; value: T } | { ok: false; error: unknown }

/**
 * 最小 workspace-files remote 面（签名出处 = workspaceFiles 命名空间生成的
 * remote 面，0.1.7）：readBytes(sessionId, path, options, signal) 读完整文件或
 * 字节窗口，返回原生字节（WorkspaceFileBytes 子集，只取 value.data 的
 * Uint8Array）。整文件读取 options = {}（无 range → 整文件上限 maxFileBytes，
 * 超限报 workspace-file/too-large）。
 */
interface WorkspaceFilesFace {
  readBytes(
    sessionId: string,
    path: string,
    options?: { range?: { offset?: number; length?: number }; baseFile?: string },
    signal?: AbortSignal,
  ): Promise<RemoteResultLike<{ data: Uint8Array }>>
}

/** 最小 remote 服务面（只读 workspaceFiles 命名空间，供 v0.1.3 PTC 文件分支）。 */
interface RemoteFace {
  workspaceFiles?: WorkspaceFilesFace
}

// ─────────────────────────────────────────────────────────────────────────────
// CampusTail：conversation.chat.turnTail 槽组件（v0.1.4）
//
// 0.1.7 槽契约（对照 host ui-chat contract/slots.ts 'conversation.chat.turnTail'
// 与 chat/TurnTailNodeView.tsx）：owner = TurnTailOwnerProps { turn, seq,
// openFile }；turn 为 host TurnLocation——本回合的 turn 作用域 Location 数据
// 经 turn.data.get('campus-cards') 读（数据面见 campus-cards.ts）。
// renderer register spec = { name, key?, id?, order?, label, locale?, inject }；
// 组件 props = 五 shares + t + owner + inject 面成员（verbatim 合成）——
// 自型最小化：只声明用到的 turn / openFile 与 inject 面成员，多余 props 忽略。
// ─────────────────────────────────────────────────────────────────────────────

/** CampusTail 最小 props 自型（owner + inject 面；五 shares / t 忽略）。 */
export interface CampusTailProps {
  /** host turn-tail owner：本回合的 TurnLocation（自写最小读面：turn 数据 store 的 get）。 */
  readonly turn?: { readonly data: { get(key: string): unknown } }
  /** host openFile（框架必传；本卡片不用，JobCardsProps 要求）。 */
  readonly openFile?: (path: string) => void
  /** 动作 prompt 通道（inject 面产物，见 apply）；缺失时动作按钮禁用。 */
  readonly sendPrompt?: (text: string) => void
  /** v0.1.3 PTC 文件分支：会话 workspace 文件加载器（inject 面产物）；缺席不进文件分支。 */
  readonly loadWorkspaceFile?: (path: string) => Promise<string | null>
}

const tailWrapStyle = { display: 'flex', flexDirection: 'column' as const, gap: 10 }
const tailCrashStyle = {
  border: '1px solid rgba(255,255,255,0.14)',
  borderRadius: 8,
  padding: '10px 12px',
  fontSize: 12,
  color: '#d15454',
}

/**
 * turn-tail 卡片：从 owner 的 turn 位置读 'campus-cards' 数据（wire 不可信：
 * 非对象 / cards 非数组按无处理），逐项渲染 JobCards（组件本体零改动：
 * parseCard 分支 / 三 tab / 逐项校验 / GenericRow / CrashRow 全部复用）。
 * 永不白屏：数据缺席 / cards 空 → 渲染 null（不产出条目）；单项数据畸形或
 * 渲染 throw → 该项兜底最小 generic 行（JobCards 自带 try/catch，本层是
 * 外层防御——单项崩溃不连坐整列）。
 */
export function CampusTail(props: CampusTailProps): ReactElement | null {
  const raw = props.turn?.data?.get('campus-cards')
  const record = raw !== null && typeof raw === 'object' && !Array.isArray(raw) ? (raw as { cards?: unknown }) : null
  const cards = record !== null && Array.isArray(record.cards) ? record.cards : null
  if (cards === null || cards.length === 0) return null
  // JobCards 无打开文件动作，但 props 要求；host 恒传 openFile，缺省时 no-op。
  const openFile = props.openFile ?? (() => { /* 无打开文件动作 */ })
  return (
    <div style={tailWrapStyle}>
      {cards.map((card, index) => (
        <CardItem
          key={`${card?.callId ?? 'unknown'}#${index}`}
          card={card as CampusCardEntry | null | undefined}
          sendPrompt={props.sendPrompt}
          loadWorkspaceFile={props.loadWorkspaceFile}
          openFile={openFile}
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
    <div style={tailCrashStyle}>
      卡片渲染失败（{props.toolName}）：{msg}
    </div>
  )
}

/**
 * client 半场注入声明：slots（turn-tail 卡片注册）+ sessions（动作 prompt 通道）
 * + configForms（v0.1.4 设置页卡片：form 单例 + whileServed 服务监听注册）
 * + remote / remote.workspaceFiles（v0.1.3 PTC 文件分支的活读通道；
 * remote 按 v0.1 口径 8 声明，gateway client 按命名空间名注册该 remote
 * 命名空间）+ uiConversation（回答区卡片的数据面注册；v0.1.3 增
 * PTC 卫星注册）。v0.1.3：inject 面 loadWorkspaceFile 读 workspace-files
 * remote 面（PTC 文件分支，见 JobCards.tsx）。
 */
export const inject = ['slots', 'sessions', 'configForms', 'remote', 'remote.workspaceFiles', 'uiConversation']

export function apply(ctx: Context): void {
  const slots = ctx.slots
  if (slots === undefined) return
  // inject 声明保证框架语境下 apply 时 sessions 已就绪；非框架语境缺失
  // 时退化为 undefined 面 → sendPrompt no-op → 动作按钮禁用。
  const sessions = (ctx.get?.('sessions') ?? undefined) as SessionsFace | undefined

  /** 构造一个 session-scope inject 面：闭包捕获框架解析的 sessionId（单参形态）。 */
  const injectFace = (sessionId: string): {
    sendPrompt: (text: string) => void
    loadWorkspaceFile: (path: string) => Promise<string | null>
  } => ({
    sendPrompt(text: string): void {
      const face = sessions?.binding(sessionId)?.session
      if (face === undefined) return
      // Promise.resolve().then 包裹：防御 prompt 同步 throw（真实框架返回
      // Promise，此层不假设其返回值形态，同步 throw 也归一到 rejection）。
      Promise.resolve()
        .then(() => face.prompt([{ type: 'text', text }], 'queue'))
        .catch(() => {
          // prompt 失败会体现在会话面的 promptError；这里静默，
          // 避免产生未处理的 rejection。
        })
    },
    // v0.1.3 PTC 文件分支（0.1.7 契约 readBytes）：活读会话 workspace 文件
    // （workspace-files remote 面，原生字节 → UTF-8 文本）；remote 面缺席 /
    // 非 ok（含超限 workspace-file/too-large）/ 任何 throw → null（JobCards 侧
    // 回退 generic 行）。
    async loadWorkspaceFile(path: string): Promise<string | null> {
      const remote = (ctx.get?.('remote') ?? undefined) as RemoteFace | undefined
      const ns = remote?.workspaceFiles
      if (ns === undefined) return null
      try {
        const res = await ns.readBytes(sessionId, path, {})
        if (res.ok !== true) return null
        return new TextDecoder('utf-8').decode(res.value.data)
      } catch {
        return null // remote 调用 throw（含解码失败）→ null
      }
    },
  })

  // ── 回答区卡片（v0.1.4：turn-tail 槽；v0.1.3 增 PTC 卫星）──
  // 数据面：注册 per-turn 会话节点 definition（state-only：收集本回合 4 个
  // campus 工具的已落定结果，经 buildLocationData 发布 turn 作用域数据）+
  // PTC 卫星 definition（state-only：收集 run_code 内 pack 的 campus 卡片
  // 并经 step 作用域发布 Location 数据，由 per-turn 在 turn/end 聚合）。
  // 面缺席——非 UI 宿主——跳过，同 slots 守卫口径。
  const uiConversation = ctx.uiConversation
  if (uiConversation !== undefined) {
    uiConversation.events.register(campusCardsDefinition)
    uiConversation.events.register(campusCardsPtcDefinition)
  }
  // 渲染面：session-scope turn-tail 列表槽（0.1.7 ui-deliverables 先例：
  // ctx.slots.inject + register；新 id 追加一个条目、条目无内容渲染 null）；
  // owner = { turn, seq, openFile }，CampusTail 从 turn 位置读数据；
  // inject 面首参 = 框架解析的 sessionId（复用 sendPrompt 通道）。
  slots.inject('conversation.chat.turnTail', () => slots.register({
    name: 'conversation.chat.turnTail',
    id: 'campus-cards',
    inject: injectFace,
  }, CampusTail))

  // ── 设置页卡片（v0.1.4，0.1.7 client 契约：ConfigForms）──
  // form 单例：configForms.get 取（由 ConfigForms 持有；卡片读（hooks.form
  // 隔间 → useForm）与写（setField / resetField 闭包）共用同一 form）。面
  // 缺席（非 UI 宿主）时跳过注册、不抛（守卫口径同原 settingsScope）。
  const configForms = ctx.configForms
  if (configForms === undefined) return
  const form = configForms.get<Config>(NS)

  /**
   * 保存一个顶层字段：form.set 的薄封装——true = Host 接受；false = 拒绝
   * 或跳写（form 已做 latest-write 镜像恢复，调用方直接以返回布尔 + 下一
   * 轮 snapshot 为准）；transport 失败 reject → 归一为 false（按钮可重试）。
   */
  const setField = async (field: string, value: unknown): Promise<boolean> => {
    try {
      return await form.set(field, value)
    } catch {
      return false
    }
  }

  /** 恢复默认一个顶层字段：form.unset 的薄封装（清 user 层回 base 继承）；
   * false / reject 口径同 setField。 */
  const resetField = async (field: string): Promise<boolean> => {
    try {
      return await form.unset(field)
    } catch {
      return false
    }
  }

  /** root-scope inject 面（零参工厂）：裸 observable form + 写薄封装。 */
  const sectionInject = (): SettingsSectionInject => ({ hooks: { form }, setField, resetField })

  // 注册 mirror 驱动：namespace 未服务时零注册、服务后注册、撤了经
  // slots.inject 的 disposer 自动回滚；ctx.effect 包裹，监听生命周期随
  // 插件 fiber（0.1.7 ui-settings-web-search 先例）。
  ctx.effect(() => configForms.whileServed([NS], () => slots.inject('settings.section', () => slots.register({
    name: 'settings.section',
    id: NS,
    order: 50,
    label: () => '校招求职',
    inject: sectionInject,
  }, CampusHuntSection))))
}
