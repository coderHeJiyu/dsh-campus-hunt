/**
 * dsh-campus-hunt · client 半场入口（v0.1 / v0.1.1 / v0.1.3）。
 *
 * v0.1.1：校招岗位卡片由工具调用行迁移至「正式回答区」——注册
 * 自定义会话节点 campus-cards（数据面 `ctx.uiConversation.events.register`
 * + 渲染面 keyed 槽 `conversation.chat.node` key='campus-cards'，见
 * campus-cards.ts / CampusCardsView.tsx）：卡片锚定在回合末尾（有文本
 * 答案 S+0.075、无则 endSeq-0.05），compact / normal 双模式可见，不再被
 * 进程 disclosure 折叠。JobCards 组件本体零改动，4 个工具键
 * （campus_job_search / campus_job_detail / campus_schedule / job_track）
 * 的已落定结果同口径汇入一张尾卡（卡片分支由 block.meta.card
 * 或 content 规范值 JSON 决定）。
 *
 * v0.1.3：卡片支持 PTC 工具呈现——host 以 presentAs('ptc') 呈现工具时
 * 顶层只暴露 run_code，4 个 campus 工具被 pack 成 run_code 内的
 * tool/ptc-dispatch；数据面双注册（per-turn 节点 + state-only 卫星
 * campusCardsPtcDefinition，见 campus-cards.ts）：卫星经 step 作用域
 * 发布 Location 数据，per-turn 节点在 turn/end 聚合。native 呈现行为
 * 不变。渲染面增 PTC 文件分支：inject 面新增成员 loadWorkspaceFile(path)
 * 经 workspace-files remote 面读会话 workspace 文件（base64 → UTF-8 文本），
 * PTC 呈现 meta 缺席时卡片活读 jobs.json / track.json / schedule.json 重建
 * 规范值并复用卡片体（见 JobCards.tsx）；remote 面缺席 / 读取失败 → null →
 * 回退 generic 行，native 不受影响。
 *
 * v0.1：另在 `settings.section` 槽注册设置页卡片（CampusHuntSection，
 * 见 settings.tsx）——经 `ctx.settingsScope.bind({ namespace })` 建单例
 * scope（口径 7/8），写编排在 inject 工厂闭包内（setField / resetField；
 * live 缺陷 A/B 修复：连写值条件等待（条件 = 快照值到达本写期望值、上界
 * = write 超时，v0.1 缺陷 A 复测）+ 写超时兜底，见 writeTimings）。
 *
 * 先例：DSH 外部插件形态（模块级 inject 数组 + 逐个 register、
 * `ctx.slots === undefined` 守卫、内联中文与内联样式、无
 * locale——外部插件不依赖 harness 的 locale 基建）。
 *
 * 动作通道：回答区卡片注册（conversation.chat.node，session scope）携带
 * `inject` 面——框架解析的 sessionId 作为工厂首参（session scope 的
 * InjectParams = [sessionId]；renderer 按声明派生位置参），工厂返回
 * `{ sendPrompt(text) }`：闭包捕获 sessions 服务与 sessionId，动作经
 * `binding(sessionId).session.prompt([{type:'text',text}],'queue')` 入队。
 * 组件侧 inject 面成员 verbatim 进 props（InjectFace 合成），故
 * JobCards 只收 `sendPrompt?: (text) => void`。两场景区分：无 inject
 * 面（非框架渲染）→ props 无 sendPrompt → 按钮禁用；框架渲染但
 * sessions 面 / binding 不可用 → sendPrompt 仍是函数、点击静默 no-op。
 *
 * 类型说明：@deepseek-ai/cordis 的 Context 不声明 slots / uiConversation
 * （那是 dsh-client 侧的声明合并，本插件未依赖该包），此处本地合并最小
 * 面（slots 只用 inject / register 两个方法；uiConversation 只用
 * events.register）；sessions 服务同样不装 dsh-api-session-controller，
 * 按 wire 形态内联最小结构类型。settingsScope 服务（dsh-client-ui-settings
 * 提供）同样按 wire 形态自写最小结构类型（见 settings.tsx）。运行时实现
 * 均由宿主注入。
 */
import type { Context } from '@deepseek-ai/cordis'

import {
  campusCardsDefinition,
  campusCardsPtcDefinition,
  type CampusCardsDefinition,
  type CampusPtcDefinition,
} from './campus-cards.ts'
import { CampusCardsView } from './CampusCardsView.tsx'
import { CampusHuntSection, isOverridden, jsonEqual } from './settings.tsx'
import type { SettingsSectionInject, TopField, WriteOutcome } from './settings.tsx'
import { NS } from '../ns.ts'
import type { Config } from '../config.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** client 侧 slots 服务（宿主注入；非 client 语境下为 undefined）。 */
    slots?: {
      inject(name: string, contribution: () => unknown): void
      register(
        spec: {
          name: string
          key?: string
          id?: string
          order?: number
          label?: string
          /**
           * session-scope 槽（conversation.chat.node）：框架把解析出的
           * sessionId 作为工厂首参；root-scope 槽（settings.section）：
           * 零参工厂。
           */
          inject?: ((sessionId: string) => { sendPrompt: (text: string) => void; loadWorkspaceFile: (path: string) => Promise<string | null> }) | (() => SettingsSectionInject)
        },
        component: unknown,
      ): unknown
    }
    /** settings-scope 服务（宿主 ui-settings 提供；设置页卡片的读写路径）。 */
    settingsScope?: {
      bind<T>(spec: { namespace: string; decode?: (section: unknown) => T | undefined }): import('./settings.tsx').SettingsScopeLike<T>
    }
    /**
     * 会话节点事件面（宿主 ui-conversation 提供，dsh-client-ui-conversation
     * 的 `ctx.uiConversation`）：`events.register(definition)` 注册
     * conversation 节点 definition（回答区卡片的数据面，见 campus-cards.ts；
     * v0.1.3 双注册：per-turn 节点 + PTC 卫星）。缺席（非 UI 宿主）时
     * 跳过注册，同 slots 守卫口径。
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
 * remote 面）：readAll(sessionId, path) 返回文件完整字节的 base64
 * （WorkspaceFileBytes 子集，只取 value.data）。
 */
interface WorkspaceFilesFace {
  readAll(sessionId: string, path: string, signal?: AbortSignal): Promise<RemoteResultLike<{ data: string }>>
}

/** 最小 remote 服务面（只读 workspaceFiles 命名空间，供 v0.1.3 PTC 文件分支）。 */
interface RemoteFace {
  workspaceFiles?: WorkspaceFilesFace
}

/**
 * client 半场注入声明：slots（卡片注册）+ sessions（动作 prompt 通道）
 * + settingsScope / remote（v0.1 设置页卡片，口径 8）+ remote.workspaceFiles
 * （v0.1.3 PTC 文件分支的活读通道；gateway client 按命名空间名注册该
 * remote 命名空间）+ uiConversation（v0.1.1 回答区卡片的数据面注册；
 * v0.1.3 增 PTC 卫星注册）。
 * remote 必须声明（SA-c1 决策：ui-theme 先例——settings-scope 的失效转发
 * 订在消费 ctx 的 remote 上）；v0.1.3：inject 面 loadWorkspaceFile 读
 * workspace-files remote 面（PTC 文件分支，见 JobCards.tsx）。
 */
export const inject = ['slots', 'sessions', 'settingsScope', 'remote', 'remote.workspaceFiles', 'uiConversation']

/**
 * 写编排超时（ms；v0.1 live 缺陷 A/B 修复 + 值条件等待；测试可改小，
 * 恢复原值）。
 * - write：两个 deadline 共用本值——
 *   ① op 竞速：scope.set/unset 在此时间内未 resolve（写通道慢）→ 放弃
 *   等待，本次写按失败处理（按钮恢复可操作、允许重试），不永久卡
 *   「保存中…」；
 *   ② 值条件等待上界：同批次还有未 settle 的写时，本写 settle 不意味
 *   视图终态（同 tick 连写批次的视图只在 latest settle 时 fold，harness
 *   settings-scope.ts mutate：generation === writeGeneration →
 *   acceptView）→ settle 后轮询等快照值到达本写期望值，本项为上界
 *   （live 缺陷 A 复测修复：原条件 = revision 推进，拒绝批次视图永不
 *   推进且静止判定互相阻塞等待方、恒吃满上界，多连点累计成 25s 卡顿
 *   ——现值到达经 subscribe 立即、视图终态而值缺席一轮 settle 间隔即
 *   提前判定）。
 * - settle：值条件等待的轮询间隔：批次内已观测 op 全部 wire settle（视
 *   图终态：接受批次 fold 于末写 settle；拒绝批次仅 recover 读取、视图
 *   不再变）时首轮观测标记稳定、次轮观测提前做最终比对，不必等满 write
 *   上界（仅本写一写时 settle 后视图即终态，直接比对，无需等待）。
 */
export const writeTimings = { write: 5000, settle: 400 }

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
    // v0.1.3 PTC 文件分支：活读会话 workspace 文件（workspace-files remote
    // 面，base64 → UTF-8 文本）；remote 面缺席 / 非 ok / 任何 throw → null
    // （JobCards 侧回退 generic 行）。
    async loadWorkspaceFile(path: string): Promise<string | null> {
      const remote = (ctx.get?.('remote') ?? undefined) as RemoteFace | undefined
      const ns = remote?.workspaceFiles
      if (ns === undefined) return null
      try {
        const res = await ns.readAll(sessionId, path)
        if (res.ok !== true) return null
        const bytes = Uint8Array.from(atob(res.value.data), c => c.charCodeAt(0))
        return new TextDecoder('utf-8').decode(bytes)
      } catch {
        return null // remote 调用 throw（含解码失败）→ null
      }
    },
  })

  // ── 回答区卡片（v0.1.1；v0.1.3 增 PTC 卫星）──
  // 数据面：注册 per-turn 会话节点 definition（收集本回合 4 个 campus 工具
  // 的已落定结果）+ PTC 卫星 definition（state-only：收集 run_code 内 pack
  // 的 campus 卡片并经 step 作用域发布 Location 数据，由 per-turn 节点在
  // turn/end 聚合）。面缺席——非 UI 宿主——跳过，同 slots 守卫口径。
  const uiConversation = ctx.uiConversation
  if (uiConversation !== undefined) {
    uiConversation.events.register(campusCardsDefinition)
    uiConversation.events.register(campusCardsPtcDefinition)
  }
  // 渲染面：session-scoped keyed 槽，key='campus-cards'（不在 host 键域）；
  // inject 面首参 = 框架解析的 sessionId（复用现有 sendPrompt 通道）。
  slots.inject('conversation.chat.node', () => slots.register({
    name: 'conversation.chat.node',
    key: 'campus-cards',
    inject: injectFace,
  }, CampusCardsView))

  // ── 设置页卡片（v0.1，口径 7/8）──
  // scope 单例：apply 内 bind 一次，卡片读（hooks.scope 隔间 → useScope）
  // 与写（setField / resetField 闭包）共用；非框架语境（settingsScope 面
  // 缺席）跳过注册，不抛。
  const settingsScope = ctx.settingsScope
  if (settingsScope === undefined) return
  const scope = settingsScope.bind<Config>({ namespace: NS })

  /** 读配置值的顶层字段（Config 无索引签名，经 unknown 中转）。 */
  const fieldOf = (cfg: Config | undefined, field: string): unknown =>
    cfg !== undefined ? (cfg as unknown as Record<string, unknown>)[field] : undefined

  /**
   * 在途写计数（setField / resetField 已发起、未返回的数量；等待期间含
   * 自身）。>1 = 同批次还有其余写，本写 settle 不意味视图终态（fold 只随
   * 队列中最后一写的 settle 发生）→ 值条件等待；==1 = 仅本写，settle 后
   * 视图即终态 → 直接比对（快通道）。
   */
  let inFlightWrites = 0

  /**
   * wire 未 settle 的 op 计数（op resolve / reject 时经 op.then 递减，与
   * 本写是否还在等待无关）。视图终态 ⇔ 已观测 op 全部 wire settle：接受
   * 批次 fold 发生在末写 settle（harness settings-scope.ts mutate：仅
   * latest settle acceptView，且先于 Promise settle 完成）；拒绝批次只有
   * recover 读取、视图不再变。=0 即视图终态，可提前做最终比对（首轮观测
   * 仅标记稳定、次轮才提前判定——给末写 fold 的落地留一轮间隔，对齐
   * mock / 异步 fold 时序）。
   */
  let pendingWireOps = 0

  /**
   * 等快照到达值条件（v0.1 值条件等待，取代 revision 推进等待）。
   * 同批次里较早的写，其 Promise 先 settle 而快照尚未 fold——此时立即比
   * 对会把自身成功写误判为 rejected（live 缺陷 A / A 复测）；revision 推
   * 进只是 fold 的代理信号，拒绝批次永不推进、且等待方互相计入在途计数
   * 使静止判定死锁（25s 卡顿根因）。现等待条件 = 快照值本身：
   * 'met' = 条件满足（值已核验，fold 到达即经 subscribe 立即返回）；
   * 'folded' = 视图终态（已观测 op 全部 wire settle 且稳定一轮 settle
   * 间隔）而条件未满足，调用方做最终比对；'pending' = deadlineMs 到期而
   * 仍有 op 在 wire 上（视图未终态），调用方按 timeout 处理、允许重试。
   */
  const waitForValue = (
    condition: () => boolean,
    deadlineMs: number,
  ): Promise<'met' | 'folded' | 'pending'> =>
    new Promise(resolve => {
      const terminal = (): boolean => pendingWireOps === 0
      let done = false
      let sawTerminal = terminal()
      let unsub: (() => void) | undefined
      let poll: ReturnType<typeof setInterval> | undefined
      let timer: ReturnType<typeof setTimeout> | undefined
      const finish = (r: 'met' | 'folded' | 'pending'): void => {
        if (done) return
        done = true
        if (unsub !== undefined) unsub()
        if (poll !== undefined) clearInterval(poll)
        if (timer !== undefined) clearTimeout(timer)
        resolve(r)
      }
      if (condition()) {
        finish('met')
        return
      }
      unsub = scope.subscribe(() => { if (condition()) finish('met') })
      poll = setInterval(() => {
        if (condition()) finish('met')
        else if (sawTerminal && terminal()) finish('folded')
        else if (terminal()) sawTerminal = true
      }, writeTimings.settle)
      timer = setTimeout(() => finish(terminal() ? 'folded' : 'pending'), deadlineMs)
    })

  /**
   * 写 op 竞速（v0.1 live 缺陷 B 修复）：'settled' = op 正常
   * resolve（wire 完成）；'rejected' = op reject（wire 带错完成）；
   * 'timeout' = 超过 writeTimings.write 仍未 settle（慢写通道不得让按钮
   * 永久卡「保存中…」）。前两者都意味 wire 已 settle（调用方以 op.then
   * 递减 pendingWireOps），只有 'timeout' 时 op 仍在 wire 上、视图还可能
   * 变。setField / resetField 两条路径都经本竞速（任何写路径按钮卡住不
   * 超过 write + 核验耗时）。
   */
  const raceTimeout = (op: Promise<void>): Promise<'settled' | 'rejected' | 'timeout'> =>
    new Promise(resolve => {
      let timer: ReturnType<typeof setTimeout> | undefined
      op.then(
        () => { if (timer !== undefined) clearTimeout(timer); resolve('settled') },
        () => { if (timer !== undefined) clearTimeout(timer); resolve('rejected') },
      )
      timer = setTimeout(() => resolve('timeout'), writeTimings.write)
    })

  /**
   * 保存一个顶层字段：set 后经快照期望值比对定四态（事件编排代码可读
   * live 快照；组件渲染读一律走 selector hook）。
   * ok = 写值已在快照；rejected = 值未变（服务端拒绝，如越红线）；
   * stale = 并发改写压过了本次写（冲突，快照已自愈到最新）；
   * timeout = 写或视图等待超 deadline（缺陷 B / A 复测兜底，允许重试）。
   * 值条件等待（v0.1，缺陷 A / A 复测）：同批次还有未 settle 的写
   * （inFlightWrites>1）时，本写 settle 不意味视图终态 → 轮询等快照值 =
   * 本写发送值（上界 = write 超时，条件满足经 subscribe 立即返回；视图
   * 终态而值缺席提前最终比对）；仅本写一写时 settle 后视图即终态，直接
   * 比对（快通道保留）。
   */
  const setField = async (field: string, value: unknown): Promise<WriteOutcome> => {
    const before = scope.getSnapshot()
    const beforeValue = fieldOf(before.value, field)
    inFlightWrites++
    const op = scope.set(field, value)
    op.then(() => { pendingWireOps-- }, () => { pendingWireOps-- })
    pendingWireOps++
    const isOk = (): boolean => jsonEqual(fieldOf(scope.getSnapshot().value, field), value)
    const verdict = (): WriteOutcome => {
      if (isOk()) return 'ok'
      const current = fieldOf(scope.getSnapshot().value, field)
      if (jsonEqual(current, beforeValue)) return 'rejected'
      return 'stale'
    }
    try {
      const race = await raceTimeout(op)
      if (race !== 'settled') {
        // op reject 或 wire 超时兜底：查一次快照——值已落盘判 ok（写
        // 实际成功、只是通道慢 / 瞬时错误）；否则 timeout（允许重试）。
        return isOk() ? 'ok' : 'timeout'
      }
      if (inFlightWrites <= 1) return verdict()
      const w = await waitForValue(isOk, writeTimings.write)
      if (w === 'met') return 'ok'
      if (w === 'pending') return 'timeout'
      return verdict()
    } finally {
      inFlightWrites--
    }
  }

  /**
   * 恢复默认一个顶层字段：unset 后值应回 base 层对应字段且 user 分节不再
   * 含该字段（存在性语义：值与 base 相等的覆盖也是覆盖）；base 缺席
   *（宿主未声明组合层）或 base 无对应字段时无法核验，宽限为 ok（服务端
   * 为事实源）。四态 / 超时 / 值条件等待语义与 setField 相同。
   */
  const resetField = async (field: string): Promise<WriteOutcome> => {
    const before = scope.getSnapshot()
    const beforeValue = fieldOf(before.value, field)
    const base = before.base
    const hasBase = base !== null && typeof base === 'object' && !Array.isArray(base)
    const expected = hasBase ? (base as Record<string, unknown>)[field] : undefined
    inFlightWrites++
    const op = scope.unset(field)
    op.then(() => { pendingWireOps-- }, () => { pendingWireOps-- })
    pendingWireOps++
    // field 恒为 Config 顶层键（TopField 三分量），as 收窄给 isOverridden 参。
    const isOk = (): boolean => {
      const snap = scope.getSnapshot()
      return jsonEqual(fieldOf(snap.value, field), expected)
        && !isOverridden(snap.user, field as TopField)
    }
    const verdict = (): WriteOutcome => {
      if (isOk()) return 'ok'
      const current = fieldOf(scope.getSnapshot().value, field)
      if (jsonEqual(current, beforeValue)) return 'rejected'
      return 'stale'
    }
    try {
      const race = await raceTimeout(op)
      if (race !== 'settled') return isOk() ? 'ok' : 'timeout'
      if (!hasBase || expected === undefined) return 'ok'
      if (inFlightWrites <= 1) return verdict()
      const w = await waitForValue(isOk, writeTimings.write)
      if (w === 'met') return 'ok'
      if (w === 'pending') return 'timeout'
      return verdict()
    } finally {
      inFlightWrites--
    }
  }

  /** root-scope inject 面（零参工厂）：hooks.scope 裸 observable + 写回调。 */
  const sectionInject = (): SettingsSectionInject => ({ hooks: { scope }, setField, resetField })

  slots.inject('settings.section', () => slots.register({
    name: 'settings.section',
    id: NS,
    order: 50,
    label: '校招求职',
    inject: sectionInject,
  }, CampusHuntSection))
}
