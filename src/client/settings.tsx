/**
 * dsh-campus-hunt · 设置页卡片（v0.1，client 半场）。
 *
 * 注册进 `settings.section` 槽（设置外壳 ui-settings-general 把槽账本投影为
 * 导航，每 entry 一个设置页）。卡片自绘：内联中文 + 内联样式、无 locale
 * （外部插件先例，同 JobCards）。
 *
 * 四组表单，对应 campus-hunt namespace 的顶层字段（src/config.ts 的 Config）：
 * - 求职画像（profile）：方向 / 城市 / 目标公司 三个 tags 列表；
 * - 简历路径（resumePath）：一个 text；
 * - 专场入口（specialUrl，v0.1.1）：牛客秋招专场页 URL（备用路线
 *   直开入口）一个 text，须为 http(s) URL（格式由服务端 schema 拒绝）；
 * - 采集（collection）：allowedDomains tags + maxItemsPerRun number +
 *   minIntervalMs number。
 *
 * 读写通道（口径 7，v0.1）：
 * - 读一律经 `useScope` selector hook（框架把 inject `hooks.scope` 隔间的
 *   裸 observable 绑定为 useScope）；组件内禁手动 subscribe /
 *   useSyncExternalStore。
 * - 本地 draft 暂存（useState）：未保存不写 scope；分节保存按钮仅在该节
 *   有改动（dirty）时可用。
 * - 保存 = 逐顶层字段 `scope.set(field, value)`；恢复默认 =
 *   `scope.unset(field)`。写编排（快照期望值比对 → ok / rejected /
 *   stale / timeout 四态 + 连写值条件等待 + 写超时兜底，v0.1
 *   live 缺陷 A/B 修复）在 inject 工厂闭包里（index.tsx），组件只收
 *   setField / resetField 回调。
 * - 冲突自愈：任何非 ok 结果 → 提示条 + draft 归零（回到最新快照，服务端
 *   为事实源）。
 * - status loading / unavailable /（ready 但 value 未解码）各有独立展示；
 *   writable=false 显示只读提示条 + 表单（全部输入与按钮禁用），不白屏。
 * - 覆盖标记（「已自定义」徽章）：snapshot.user 分节存在性——值与 base
 *   相等的覆盖也是覆盖（settings-contract 注释：比较值看不见它）。
 *
 * 类型自写口径（同 JobCards.tsx）：本插件 node_modules 未装
 * @deepseek-ai/dsh-client-ui-settings，按 wire 形态自写最小结构接口
 * （SettingsScopeLike / ScopeSnapshotLike / ScopeSelectorHook）。
 */
import { useEffect, useState } from 'react'
import type { CSSProperties, ReactElement, ReactNode } from 'react'
import type { Config } from '../config.ts'

// ─────────────────────────────────────────────────────────────────────────────
// 最小 wire 类型（自写，对齐 dsh-client-ui-settings/settings-contract.ts）
// ─────────────────────────────────────────────────────────────────────────────

/** campus-hunt namespace 的顶层字段（= Config 的四个顶层键）。 */
export type TopField = 'profile' | 'resumePath' | 'specialUrl' | 'collection'

/** 一次字段写/清的结果（index.tsx 的写编排判定，v0.1 四态）。 */
export type WriteOutcome = 'ok' | 'rejected' | 'stale' | 'timeout'

/**
 * 快照最小面（SettingsScopeSnapshot 结构子集）：status / value / base /
 * user / revision / writable / mode。
 */
export interface ScopeSnapshotLike<T> {
  status: 'loading' | 'ready' | 'unavailable'
  value: T | undefined
  base: unknown
  user: unknown
  revision: number | undefined
  writable: boolean
  mode: 'host' | 'memory'
}

/** scope 最小面（SettingsScope 结构子集：快照 + 订阅 + 字段写/清）。 */
export interface SettingsScopeLike<T> {
  getSnapshot(): ScopeSnapshotLike<T>
  subscribe(listener: () => void): () => void
  set(field: string, value: unknown): Promise<void>
  unset(field: string): Promise<void>
}

/** 快照 selector hook（框架绑定的 useScope：(sel, eq?) => S）。 */
export type ScopeSelectorHook = <S>(
  sel: (s: ScopeSnapshotLike<Config>) => S,
  eq?: (a: S, b: S) => boolean,
) => S

/** 设置卡片 inject 面（hooks 隔间绑定前）：裸 observable + 写回调。 */
export interface SettingsSectionInject {
  hooks: { scope: SettingsScopeLike<Config> }
  setField: (field: string, value: unknown) => Promise<WriteOutcome>
  resetField: (field: string) => Promise<WriteOutcome>
}

/** 设置卡片组件 props（inject 面合成后：hooks.scope 绑成 useScope）。 */
export interface CampusHuntSectionProps {
  /** 框架自 inject `hooks.scope` 隔间绑定的 selector hook。 */
  useScope: ScopeSelectorHook
  /** 写一个顶层字段（保存）。 */
  setField: (field: string, value: unknown) => Promise<WriteOutcome>
  /** 清一个顶层字段（恢复默认，回 base 层）。 */
  resetField: (field: string) => Promise<WriteOutcome>
  /** 设置外壳的 owner 面（close）；本卡片不用。 */
  close?: () => void
}

// ─────────────────────────────────────────────────────────────────────────────
// 纯 helper（导出供测试）
// ─────────────────────────────────────────────────────────────────────────────

/** JSON 深比较（表单值均为 JSON 形态；undefined 两侧 stringify 均得 undefined）。 */
export function jsonEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

/** 深拷贝一个 Config（数组逐层复制；draft 的创建与归零用）。 */
export function cloneConfig(c: Config): Config {
  return {
    profile: {
      directions: [...c.profile.directions],
      cities: [...c.profile.cities],
      targetCompanies: [...c.profile.targetCompanies],
    },
    resumePath: c.resumePath,
    specialUrl: c.specialUrl,
    collection: {
      allowedDomains: [...c.collection.allowedDomains],
      maxItemsPerRun: c.collection.maxItemsPerRun,
      minIntervalMs: c.collection.minIntervalMs,
    },
  }
}

/** 覆盖标记：user 层中该分节的存在性（值与 base 相等也是覆盖）。 */
export function isOverridden(user: unknown, field: TopField): boolean {
  return user !== null
    && typeof user === 'object'
    && !Array.isArray(user)
    && (user as Record<string, unknown>)[field] !== undefined
}

// ─────────────────────────────────────────────────────────────────────────────
// 样式（内联，DSH 插件 / JobCards 惯例）
// ─────────────────────────────────────────────────────────────────────────────

const pageStyle: CSSProperties = {
  padding: '4px 2px',
  fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif',
  fontSize: 12,
  color: '#e8eaf0',
  lineHeight: 1.55,
  maxWidth: 720,
  boxSizing: 'border-box',
}
const sectionStyle: CSSProperties = {
  border: '1px solid rgba(255,255,255,0.14)',
  borderRadius: 8,
  padding: 12,
  marginBottom: 10,
  background: 'rgba(255,255,255,0.02)',
}
const sectionHeaderStyle: CSSProperties = { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }
const sectionTitleStyle: CSSProperties = { fontSize: 13, fontWeight: 600 }
const overrideBadgeStyle: CSSProperties = {
  display: 'inline-block',
  padding: '0 8px',
  borderRadius: 10,
  fontSize: 11,
  color: '#ffffff',
  background: '#9a6fd1',
}
const fieldStyle: CSSProperties = { marginBottom: 10 }
const labelStyle: CSSProperties = { color: '#c9d1e0', fontWeight: 500, marginBottom: 4 }
const hintTextStyle: CSSProperties = { color: '#8a93a6', fontSize: 11, marginBottom: 4 }
const chipRowStyle: CSSProperties = { display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }
const chipStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  padding: '1px 8px',
  borderRadius: 10,
  fontSize: 11,
  background: 'rgba(91,155,213,0.18)',
  border: '1px solid rgba(91,155,213,0.45)',
  color: '#cfe4f7',
}
const chipXStyle: CSSProperties = {
  background: 'transparent',
  border: 'none',
  color: '#a8b0c0',
  cursor: 'pointer',
  fontSize: 12,
  lineHeight: 1,
  padding: 0,
}
const inputStyle: CSSProperties = {
  flex: 1,
  minWidth: 160,
  padding: '4px 8px',
  borderRadius: 6,
  fontSize: 12,
  color: '#e8eaf0',
  background: 'rgba(0,0,0,0.25)',
  border: '1px solid rgba(255,255,255,0.18)',
  boxSizing: 'border-box',
}
const numberRowStyle: CSSProperties = { display: 'flex', gap: 8, alignItems: 'center' }
const numberInputStyle: CSSProperties = {
  width: 120,
  padding: '4px 8px',
  borderRadius: 6,
  fontSize: 12,
  color: '#e8eaf0',
  background: 'rgba(0,0,0,0.25)',
  border: '1px solid rgba(255,255,255,0.18)',
  boxSizing: 'border-box',
}
const sectionFootStyle: CSSProperties = { display: 'flex', gap: 8, marginTop: 4 }
const btnStyle = (enabled: boolean): CSSProperties => ({
  padding: '3px 12px',
  fontSize: 11,
  borderRadius: 6,
  cursor: enabled ? 'pointer' : 'not-allowed',
  opacity: enabled ? 1 : 0.45,
  background: 'transparent',
  border: `1px solid ${enabled ? 'rgba(91,155,213,0.6)' : 'rgba(255,255,255,0.18)'}`,
  color: enabled ? '#cfe4f7' : '#77808f',
})
const noticeStyle: CSSProperties = { color: '#8a93a6', fontSize: 12, padding: '8px 0' }
const warnStyle: CSSProperties = {
  padding: '6px 10px',
  borderRadius: 6,
  fontSize: 12,
  color: '#f0d9a8',
  background: 'rgba(201,151,75,0.12)',
  border: '1px solid rgba(201,151,75,0.4)',
  marginBottom: 8,
}
const mutedStyle: CSSProperties = { color: '#8a93a6', fontSize: 11 }

// ─────────────────────────────────────────────────────────────────────────────
// 组件
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 设置页卡片（settings.section entry）。渲染只读 useScope selector；
 * 写经 setField / resetField 回调；draft 本地暂存。
 */
export function CampusHuntSection(props: CampusHuntSectionProps): ReactElement {
  const status = props.useScope(s => s.status)
  const value = props.useScope(s => s.value)
  const user = props.useScope(s => s.user)
  const writable = props.useScope(s => s.writable)

  const [draft, setDraft] = useState<Config | null>(null)
  const [busy, setBusy] = useState<TopField | null>(null)
  const [outcome, setOutcome] = useState<WriteOutcome | null>(null)

  if (status === 'loading') {
    return (
      <div style={pageStyle}>
        <div style={noticeStyle}>正在加载设置…</div>
      </div>
    )
  }
  if (status === 'unavailable') {
    return (
      <div style={pageStyle}>
        <div style={warnStyle}>设置不可用：无法读取 Host 设置文档，或 campus-hunt 分节未注册。</div>
        <div style={mutedStyle}>请确认 DSH web 服务运行正常，然后重开设置页。</div>
      </div>
    )
  }
  if (value === undefined) {
    return (
      <div style={pageStyle}>
        <div style={warnStyle}>设置分节解析失败（值与 schema 不一致）。</div>
        <div style={mutedStyle}>请重启 DSH 让 host 重新注册 campus-hunt 分节后重试。</div>
      </div>
    )
  }

  const shown = draft ?? value

  const isDirty = (field: TopField): boolean => draft !== null && !jsonEqual(draft[field], value[field])

  /** 保存一个顶层字段：写后经 draft 归零回到最新快照；非 ok 显示提示。 */
  const doSave = async (field: TopField): Promise<void> => {
    if (draft === null || !isDirty(field)) return
    setBusy(field)
    setOutcome(null)
    const r = await props.setField(field, draft[field])
    setDraft(null)
    setBusy(null)
    if (r !== 'ok') setOutcome(r)
  }

  /** 恢复默认一个顶层字段（unset，回 base 层）。 */
  const doReset = async (field: TopField): Promise<void> => {
    setBusy(field)
    setOutcome(null)
    const r = await props.resetField(field)
    setDraft(null)
    setBusy(null)
    if (r !== 'ok') setOutcome(r)
  }

  // —— draft 补丁（首次改动即建 draft，未保存不写 scope）——
  const patchProfileList = (key: 'directions' | 'cities' | 'targetCompanies', tag: string): void => {
    setDraft(prev => {
      const base = (prev ?? value).profile
      if (base[key].includes(tag)) return prev
      return cloneConfig({ ...(prev ?? value), profile: { ...base, [key]: [...base[key], tag] } })
    })
  }
  const removeProfileTag = (key: 'directions' | 'cities' | 'targetCompanies', index: number): void => {
    setDraft(prev => {
      const base = (prev ?? value).profile
      return cloneConfig({ ...(prev ?? value), profile: { ...base, [key]: base[key].filter((_, i) => i !== index) } })
    })
  }
  const patchResumePath = (s: string): void => {
    setDraft(prev => cloneConfig({ ...(prev ?? value), resumePath: s }))
  }
  const patchSpecialUrl = (s: string): void => {
    setDraft(prev => {
      const base = (prev ?? value).specialUrl
      if (base === s) return prev
      return cloneConfig({ ...(prev ?? value), specialUrl: s })
    })
  }
  const patchDomains = (tag: string): void => {
    setDraft(prev => {
      const base = (prev ?? value).collection
      if (base.allowedDomains.includes(tag)) return prev
      return cloneConfig({ ...(prev ?? value), collection: { ...base, allowedDomains: [...base.allowedDomains, tag] } })
    })
  }
  const removeDomain = (index: number): void => {
    setDraft(prev => {
      const base = (prev ?? value).collection
      return cloneConfig({ ...(prev ?? value), collection: { ...base, allowedDomains: base.allowedDomains.filter((_, i) => i !== index) } })
    })
  }
  const patchCollectionNumber = (key: 'maxItemsPerRun' | 'minIntervalMs', n: number): void => {
    setDraft(prev => {
      const base = (prev ?? value).collection
      if (base[key] === n) return prev
      return cloneConfig({ ...(prev ?? value), collection: { ...base, [key]: n } })
    })
  }

  return (
    <div style={pageStyle}>
      {outcome !== null && (
        <div style={warnStyle}>
          {outcome === 'stale'
            ? '已有更新，已刷新。请重新确认后再保存。'
            : outcome === 'timeout'
              ? '保存超时（值可能已落盘），请重试。'
              : '保存的值被拒绝（可能超出红线范围或格式不合法），请修正后重试。'}
        </div>
      )}
      {!writable && (
        <div style={warnStyle}>设置当前只读：文档不接受写入（非本机页面为 memory 模式，或 Host 拒绝写入）。以下取值仅供参考。</div>
      )}
      <div style={mutedStyle}>保存后对下一次工具运行生效（host 实时读取配置，无需重启服务）。</div>

      <Section
        title="求职画像"
        overridden={isOverridden(user, 'profile')}
        dirty={isDirty('profile')}
        busy={busy === 'profile'}
        writable={writable}
        onSave={() => { void doSave('profile') }}
        onReset={() => { void doReset('profile') }}
      >
        <TagList
          label="求职方向"
          tags={shown.profile.directions}
          disabled={!writable}
          onAdd={t => patchProfileList('directions', t)}
          onRemove={i => removeProfileTag('directions', i)}
        />
        <TagList
          label="目标城市"
          tags={shown.profile.cities}
          disabled={!writable}
          onAdd={t => patchProfileList('cities', t)}
          onRemove={i => removeProfileTag('cities', i)}
        />
        <TagList
          label="目标公司"
          tags={shown.profile.targetCompanies}
          disabled={!writable}
          onAdd={t => patchProfileList('targetCompanies', t)}
          onRemove={i => removeProfileTag('targetCompanies', i)}
        />
      </Section>

      <Section
        title="简历路径"
        overridden={isOverridden(user, 'resumePath')}
        dirty={isDirty('resumePath')}
        busy={busy === 'resumePath'}
        writable={writable}
        onSave={() => { void doSave('resumePath') }}
        onReset={() => { void doReset('resumePath') }}
      >
        <div style={fieldStyle}>
          <div style={labelStyle}>简历文件路径</div>
          <div style={hintTextStyle}>本地文件路径，留空 = 未设置。求职画像只存设置分节（无 workspace 副本），经 campus_job_search 工具返回的画像行直供模型。</div>
          <input
            style={inputStyle}
            type="text"
            value={shown.resumePath}
            disabled={!writable}
            placeholder="例如 D:\cv\me.md"
            onChange={e => patchResumePath(e.target.value)}
          />
        </div>
      </Section>

      <Section
        title="专场入口"
        overridden={isOverridden(user, 'specialUrl')}
        dirty={isDirty('specialUrl')}
        busy={busy === 'specialUrl'}
        writable={writable}
        onSave={() => { void doSave('specialUrl') }}
        onReset={() => { void doReset('specialUrl') }}
      >
        <SpecialUrlField
          label="牛客秋招专场页 URL"
          value={shown.specialUrl}
          hint="牛客秋招专场页地址（备用路线直开入口）；届次切换 / 专场改版时在此修改，无需改 skill。须为 http(s) URL，默认 27 届 2027QZzc 专场。"
          disabled={!writable}
          onChange={patchSpecialUrl}
        />
      </Section>

      <Section
        title="采集"
        overridden={isOverridden(user, 'collection')}
        dirty={isDirty('collection')}
        busy={busy === 'collection'}
        writable={writable}
        onSave={() => { void doSave('collection') }}
        onReset={() => { void doReset('collection') }}
      >
        <TagList
          label="域名白名单"
          hint="仅采集白名单内域名（host 后缀匹配）；白名单外一律拒绝。"
          tags={shown.collection.allowedDomains}
          disabled={!writable}
          onAdd={patchDomains}
          onRemove={removeDomain}
        />
        <NumberField
          label="单次采集条数上限"
          value={shown.collection.maxItemsPerRun}
          min={1}
          max={50}
          hint="红线：1–50，只收紧不放松（越界值保存时被拒绝）。"
          disabled={!writable}
          onChange={n => patchCollectionNumber('maxItemsPerRun', n)}
        />
        <NumberField
          label="页面导航最小间隔"
          value={shown.collection.minIntervalMs}
          min={1000}
          max={600000}
          hint="毫秒；红线：1000–600000，只收紧不放松。"
          disabled={!writable}
          onChange={n => patchCollectionNumber('minIntervalMs', n)}
        />
      </Section>
    </div>
  )
}

/** 一个设置分组：标题 + 覆盖徽章 + 表单体 + 保存 / 恢复默认。 */
function Section(props: {
  title: string
  overridden: boolean
  dirty: boolean
  busy: boolean
  writable: boolean
  onSave: () => void
  onReset: () => void
  children: ReactNode
}): ReactElement {
  return (
    <section style={sectionStyle}>
      <div style={sectionHeaderStyle}>
        <span style={sectionTitleStyle}>{props.title}</span>
        {props.overridden && <span style={overrideBadgeStyle}>已自定义</span>}
      </div>
      {props.children}
      <div style={sectionFootStyle}>
        <button
          style={btnStyle(props.dirty && props.writable)}
          disabled={!props.dirty || !props.writable || props.busy}
          onClick={props.onSave}
        >
          {props.busy ? '保存中…' : '保存'}
        </button>
        <button
          style={btnStyle(props.writable)}
          disabled={!props.writable || props.busy}
          onClick={props.onReset}
        >
          恢复默认
        </button>
      </div>
    </section>
  )
}

/** tags 编辑器：chips（点 × 删）+ 输入框（Enter 加）。 */
function TagList(props: {
  label: string
  hint?: string
  tags: string[]
  disabled: boolean
  onAdd: (tag: string) => void
  onRemove: (index: number) => void
}): ReactElement {
  const [text, setText] = useState('')
  const commit = (): void => {
    const t = text.trim()
    if (t === '') return
    if (!props.tags.includes(t)) props.onAdd(t)
    setText('')
  }
  return (
    <div style={fieldStyle}>
      <div style={labelStyle}>{props.label}</div>
      {props.hint !== undefined && <div style={hintTextStyle}>{props.hint}</div>}
      <div style={chipRowStyle}>
        {props.tags.map((tag, i) => (
          <span key={`${tag}#${i}`} style={chipStyle}>
            {tag}
            {!props.disabled && (
              <button style={chipXStyle} onClick={() => props.onRemove(i)} aria-label={`移除 ${tag}`}>×</button>
            )}
          </span>
        ))}
        <input
          style={inputStyle}
          value={text}
          disabled={props.disabled}
          placeholder="输入后按回车添加"
          onChange={e => setText(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter') {
              e.preventDefault()
              commit()
            }
          }}
        />
      </div>
    </div>
  )
}

/** number 字段：本地 text + 失焦/回车提交（越界不 clamp——由服务端 schema 拒绝并提示）。 */
function NumberField(props: {
  label: string
  value: number
  min: number
  max: number
  hint?: string
  disabled: boolean
  onChange: (n: number) => void
}): ReactElement {
  const [text, setText] = useState(String(props.value))
  // 外部 value 变化（draft 归零 / 冲突自愈）时同步本地输入文本。
  useEffect(() => {
    setText(String(props.value))
  }, [props.value])
  const commit = (): void => {
    const n = Number(text)
    if (!Number.isFinite(n)) return
    props.onChange(n)
  }
  return (
    <div style={fieldStyle}>
      <div style={labelStyle}>{props.label}</div>
      {props.hint !== undefined && <div style={hintTextStyle}>{props.hint}</div>}
      <div style={numberRowStyle}>
        <input
          style={numberInputStyle}
          type="number"
          min={props.min}
          max={props.max}
          step={1}
          value={text}
          disabled={props.disabled}
          onChange={e => setText(e.target.value)}
          onBlur={() => commit()}
          onKeyDown={e => {
            if (e.key === 'Enter') {
              e.preventDefault()
              commit()
            }
          }}
        />
        <span style={hintTextStyle}>{props.min}–{props.max}</span>
      </div>
    </div>
  )
}

/** text 字段：本地 text + 失焦/回车提交（不做本地格式拦截——非法值由
 * 服务端 schema 拒绝并提示，v0.1.1）。 */
function SpecialUrlField(props: {
  label: string
  value: string
  hint?: string
  disabled: boolean
  onChange: (s: string) => void
}): ReactElement {
  const [text, setText] = useState(props.value)
  // 外部 value 变化（draft 归零 / 冲突自愈）时同步本地输入文本。
  useEffect(() => {
    setText(props.value)
  }, [props.value])
  const commit = (): void => {
    props.onChange(text)
  }
  return (
    <div style={fieldStyle}>
      <div style={labelStyle}>{props.label}</div>
      {props.hint !== undefined && <div style={hintTextStyle}>{props.hint}</div>}
      <input
        style={inputStyle}
        type="text"
        value={text}
        disabled={props.disabled}
        onChange={e => setText(e.target.value)}
        onBlur={() => commit()}
        onKeyDown={e => {
          if (e.key === 'Enter') {
            e.preventDefault()
            commit()
          }
        }}
      />
    </div>
  )
}
