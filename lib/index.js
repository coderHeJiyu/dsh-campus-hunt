import { defineTool } from "@deepseek-ai/dsh-tools";
import { rename, stat, unlink, writeFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import z from "@deepseek-ai/schemastery";
//#region src/nowcoder/types.ts
/**
* dsh-campus-hunt — 领域类型（v0.1）。
*
* Job / Track / ScheduleItem 三个核心实体的规范类型，供数据层
* （src/data/store.ts）与工具层（src/tools/*）共享。全部为纯类型模块：
* 零运行时依赖，可安全被 node 半场与 client 半场同时 import。
*
* v0.1：Job 增可选 jd（增量字段，schema v0 不 bump）；ScheduleItem
* 适配真实日程页（type 改批次标签原文 string，openDate 改可选收录日期）。
* v0.1（字段扩展修正）：Job 再增可选 graduationYear（毕业要求原文）、
* ScheduleItem 再增可选 cities（地点城市串原文）；均为增量字段，schema v0 不 bump。
*
* schema v0：结构变更时 bump 版本并走 store 的备份迁移（.pre-schema-<v>.bak）。
*/
/** 投递状态枚举（中文直值：模型输入、GUI 展示、JSON 存储三方一致，v0.1 口径）。 */
const TRACK_STATUSES = [
	"未处理",
	"已投递",
	"笔试",
	"面试",
	"已拒",
	"offer"
];
/** 三个数据文件的文件名。 */
const STORE_FILES = {
	jobs: "jobs.json",
	track: "track.json",
	schedule: "schedule.json"
};
/** 数据文件路径。 */
function storePath(workspaceRoot, file) {
	return join(workspaceRoot, STORE_FILES[file]);
}
/** 读一个数据文件；文件不存在返回 empty（空数据），不做备份/写入。 */
async function readEnvelope(workspaceRoot, file, empty) {
	const path = storePath(workspaceRoot, file);
	let raw;
	try {
		const { readFile } = await import("node:fs/promises");
		raw = await readFile(path, "utf8");
	} catch (error) {
		if (error.code === "ENOENT") return empty;
		throw new Error(`dsh-campus-hunt: cannot read ${file}: ${String(error)}`, { cause: error });
	}
	let parsed;
	try {
		parsed = JSON.parse(raw);
	} catch (error) {
		throw new Error(`dsh-campus-hunt: ${file} is not valid JSON: ${String(error)}`, { cause: error });
	}
	const envelope = parsed;
	if (typeof envelope !== "object" || envelope === null || envelope.schema !== 0) {
		const backupPath = `${path}.pre-schema-0.bak`;
		await writeFile(backupPath, raw, "utf8");
		return empty;
	}
	return envelope.data ?? empty;
}
/** 写一个数据文件（信封 { schema, data }，2 空格缩进 + 尾换行；tmp+rename 原子替换）。 */
async function writeEnvelope(workspaceRoot, file, data) {
	const path = storePath(workspaceRoot, file);
	const tmpPath = `${path}.tmp`;
	await writeFile(tmpPath, JSON.stringify({
		schema: 0,
		data
	}, null, 2) + "\n", "utf8");
	try {
		await rename(tmpPath, path);
	} catch (error) {
		await unlink(tmpPath).catch(() => {});
		throw new Error(`dsh-campus-hunt: cannot write ${file}: ${String(error)}`, { cause: error });
	}
}
/** 读 track.json（缺失 → 空台账）。 */
function readTrack(workspaceRoot) {
	return readEnvelope(workspaceRoot, "track", { tracks: [] });
}
/** 写 track.json。 */
function writeTrack(workspaceRoot, data) {
	return writeEnvelope(workspaceRoot, "track", data);
}
/** 读 jobs.json（缺失 → 空岗位库）。 */
function readJobs(workspaceRoot) {
	return readEnvelope(workspaceRoot, "jobs", { jobs: [] });
}
/** 写 jobs.json。 */
function writeJobs(workspaceRoot, data) {
	return writeEnvelope(workspaceRoot, "jobs", data);
}
/** 读 schedule.json（缺失 → 空日程；M2 用）。 */
function readSchedule(workspaceRoot) {
	return readEnvelope(workspaceRoot, "schedule", { items: [] });
}
/** 写 schedule.json（M2 用）。 */
function writeSchedule(workspaceRoot, data) {
	return writeEnvelope(workspaceRoot, "schedule", data);
}
/**
* 会话 workspace 根（当前活跃 workspace，local-first 口径）。
*
* 与官方 tool-fs 的 session-cwd 机制一致：取调用 agent 的会话头 cwd
* （exec.agent.session.header.cwd，绝对路径）。非 agent 调用（无 exec.agent
* 或无 cwd）没有可归属的 workspace → 抛错（工具 isError），绝不回退
* process.cwd()（那是宿主启动目录，不是会话 workspace）。
*
* @param agentCwd - exec.agent?.session?.header?.cwd 的只读快照。
* @returns 绝对 workspace 根路径。
*/
function resolveWorkspaceRoot(agentCwd) {
	if (typeof agentCwd !== "string" || agentCwd.length === 0) throw new Error("dsh-campus-hunt: 需要 agent 会话的 workspace 路径（session header cwd）；本调用没有可用的会话 workspace，无法定位 jobs.json / track.json");
	if (!isAbsolute(agentCwd)) throw new Error(`dsh-campus-hunt: session workspace 必须是绝对路径，收到 "${agentCwd}"`);
	return agentCwd;
}
/** workspace 根必须存在且是目录（写前检查，错误信息可定位）。 */
async function assertWorkspaceRoot(root) {
	try {
		if (!(await stat(root)).isDirectory()) throw new Error("not a directory");
	} catch (error) {
		throw new Error(`dsh-campus-hunt: workspace 目录不可用（${root}）：${String(error)}`);
	}
}
//#endregion
//#region src/tools/job-track.ts
/**
* dsh-campus-hunt — job_track 工具（v0.1）。
*
* 本地投递流水线：纯 JSON 读写会话 workspace 下的 track.json，**无任何网络 I/O**。
* 四个 action：
*   list   列出全部追踪记录 + 按状态汇总（GUI「投递追踪」tab 数据源）
*   add    新增（或就地位更新）一条追踪记录；jobId 或 公司+岗位名 定位
*   update 更新既有记录的 status/note/deadline（至少一项）
*   status 更新既有记录的状态（update 的快捷形式）
*
* workspace 归属：exec.agent.session.header.cwd（官方 tool-fs session-cwd 机制，
* v0.1 口径）；非 agent 调用无会话 workspace → execute 抛错（isError）。
*
* v0.1.1（无变化分支）：update / status 所给字段与当前值全等（含 status 快捷
* 形式）→ 不抛错、不推进 updatedAt、跳过 writeTrack，返回 tracks/summary 原样 +
* changed: false（render 首行前置「已是目标状态，本次无变更」）；真实变更返回
* changed: true；list / add 结果不含 changed 键。
*/
/** 各状态计数（六个枚举全列，缺省 0 —— GUI stat 单元格稳定）。 */
function summarize(data) {
	const byStatus = Object.fromEntries(TRACK_STATUSES.map((s) => [s, 0]));
	for (const track of data.tracks) byStatus[track.status] += 1;
	return {
		byStatus,
		total: data.tracks.length
	};
}
/** 未采集岗位（无牛客 jobId）时的稳定 id：公司+岗位名 直连。 */
function deriveJobId(company, title) {
	return `${company.trim()}-${title.trim()}`;
}
/** 模型可见的紧凑渲染（中文直值，与存储一致）。 */
function renderTrackResult(value) {
	if (value.summary.total === 0) return "投递追踪为空：还没有跟踪任何岗位（用 job_track action=add 新增）。";
	const counts = TRACK_STATUSES.filter((s) => value.summary.byStatus[s] > 0).map((s) => `${s} ${value.summary.byStatus[s]}`).join("，");
	const lines = value.tracks.map((t) => {
		const extras = [];
		if (t.deadline !== void 0) extras.push(`截止 ${t.deadline}`);
		if (t.note !== void 0) extras.push(`备注 ${t.note}`);
		return `- [${t.status}] ${t.company} · ${t.title}${extras.length > 0 ? `（${extras.join("，")}）` : ""}`;
	});
	return `${value.changed === false ? "已是目标状态，本次无变更。" : ""}追踪 ${value.summary.total} 个岗位（${counts}）：\n${lines.join("\n")}`;
}
/**
* 卡片投影（v0.1）：规范值 → 可回放 JSON（card:'tracks'）。纯投影：
* tracks/summary 原样透传（registry 边界已按 output schema 校验，client 侧
* 逐条再校验）；value 非对象（脏值，仅直接调用可达）→ `{ card: null }`，
* client 回退 generic 行。
*/
function projectTracksCard(value) {
	if (typeof value !== "object" || value === null || Array.isArray(value)) return {
		card: null,
		tool: "job_track",
		tracks: [],
		summary: null
	};
	const v = value;
	const s = v.summary;
	const byStatus = s !== null && typeof s === "object" && !Array.isArray(s) ? s.byStatus : void 0;
	const summary = byStatus !== null && typeof byStatus === "object" && !Array.isArray(byStatus) ? s : null;
	return {
		card: "tracks",
		tool: "job_track",
		tracks: Array.isArray(v.tracks) ? v.tracks : [],
		summary
	};
}
function sessionCwd(exec) {
	return exec.agent?.session?.header?.cwd;
}
function findTrack(data, args) {
	if (args.jobId !== void 0) return data.tracks.find((t) => t.id === args.jobId);
	return data.tracks.find((t) => t.company === args.company && t.title === args.title);
}
/** 定位 add 的记录键：jobId 优先；否则 company+title（派生 id）。 */
function addKey(args) {
	if (args.jobId !== void 0) {
		if (args.company !== void 0 && args.title !== void 0) return {
			id: args.jobId,
			company: args.company,
			title: args.title
		};
		throw new Error("job_track add：给了 jobId 时必须同时给 company 和 title（用于记录展示）");
	}
	if (args.company === void 0 || args.title === void 0) throw new Error("job_track add：需要 jobId，或 company + title 定位岗位");
	return {
		id: deriveJobId(args.company, args.title),
		company: args.company,
		title: args.title
	};
}
const jobTrackTool = defineTool({
	name: "job_track",
	description: "校招投递流水线（纯本地，无网络）。管理会话 workspace 下 track.json 的投递状态台账：list 列出全部记录与按状态汇总；add 新增一条（jobId 或 company+title 定位，重复即就地位更新）；update 修改既有记录的 status/note/deadline；status 修改既有记录的状态。status 取值：未处理 / 已投递 / 笔试 / 面试 / 已拒 / offer。",
	parameters: {
		action: {
			type: "string",
			required: true,
			enum: [
				"list",
				"add",
				"update",
				"status"
			],
			description: "操作：list=列出全部；add=新增/更新一条；update=改既有记录的字段；status=改既有记录的状态。"
		},
		jobId: {
			type: "string",
			description: "岗位 id（与 jobs.json 的牛客岗位 id 一致；未采集岗位可省略，改用 company+title）。"
		},
		company: {
			type: "string",
			description: "公司名（无 jobId 时与 title 一起定位岗位；add 带 jobId 时也必填用于展示）。"
		},
		title: {
			type: "string",
			description: "岗位名（无 jobId 时与 company 一起定位岗位）。"
		},
		status: {
			type: "string",
			enum: [...TRACK_STATUSES],
			description: "投递状态（add 省略时默认 未处理；status 必填；update 可选）。"
		},
		note: {
			type: "string",
			description: "可选备注（面试轮次、笔试提示等人工信息）。"
		},
		deadline: {
			type: "string",
			description: "可选截止时间，建议 ISO YYYY-MM-DD（把\"12.31\"换算成完整日期后传入）。"
		}
	},
	output: {
		schema: {
			type: "object",
			additionalProperties: false,
			properties: {
				tracks: {
					type: "array",
					required: true,
					items: {
						type: "object",
						additionalProperties: false,
						properties: {
							id: {
								type: "string",
								required: true
							},
							company: {
								type: "string",
								required: true
							},
							title: {
								type: "string",
								required: true
							},
							status: {
								type: "string",
								required: true,
								enum: [...TRACK_STATUSES]
							},
							note: { type: "string" },
							deadline: { type: "string" },
							createdAt: {
								type: "string",
								required: true
							},
							updatedAt: {
								type: "string",
								required: true
							}
						}
					}
				},
				summary: {
					type: "object",
					additionalProperties: false,
					required: true,
					properties: {
						byStatus: {
							type: "object",
							additionalProperties: true,
							required: true,
							properties: {
								未处理: {
									type: "integer",
									required: true
								},
								已投递: {
									type: "integer",
									required: true
								},
								笔试: {
									type: "integer",
									required: true
								},
								面试: {
									type: "integer",
									required: true
								},
								已拒: {
									type: "integer",
									required: true
								},
								offer: {
									type: "integer",
									required: true
								}
							}
						},
						total: {
							type: "integer",
							required: true
						}
					}
				},
				changed: { type: "boolean" }
			}
		},
		render: (_args, value) => [{
			type: "text",
			text: renderTrackResult(value)
		}],
		presentationMeta: (_args, value) => projectTracksCard(value)
	},
	async execute(args, exec) {
		const root = resolveWorkspaceRoot(sessionCwd(exec));
		await assertWorkspaceRoot(root);
		exec.signal.throwIfAborted();
		const data = await readTrack(root);
		if (args.action === "list") return {
			tracks: data.tracks,
			summary: summarize(data)
		};
		if (args.action === "add") {
			const key = addKey(args);
			const now = (/* @__PURE__ */ new Date()).toISOString();
			const existing = data.tracks.find((t) => t.id === key.id);
			const track = existing ?? {
				id: key.id,
				company: key.company,
				title: key.title,
				status: "未处理",
				createdAt: now,
				updatedAt: now
			};
			if (args.status !== void 0) track.status = args.status;
			if (args.note !== void 0) track.note = args.note;
			if (args.deadline !== void 0) track.deadline = args.deadline;
			if (existing === void 0) data.tracks.push(track);
			await writeTrack(root, data);
			return {
				tracks: data.tracks,
				summary: summarize(data)
			};
		}
		const target = findTrack(data, args);
		if (target === void 0) {
			const where = args.jobId !== void 0 ? `jobId=${args.jobId}` : `company=${args.company} title=${args.title}`;
			throw new Error(`job_track ${args.action}：track.json 中找不到 ${where} 的记录；请先用 action=add 新增`);
		}
		if (args.action === "status") {
			if (args.status === void 0) throw new Error("job_track status：必须给 status");
			if (args.status === target.status) return {
				tracks: data.tracks,
				summary: summarize(data),
				changed: false
			};
			target.status = args.status;
		} else {
			if (!(args.status !== void 0 || args.note !== void 0 || args.deadline !== void 0)) throw new Error("job_track update：status / note / deadline 至少给一项");
			if (!(args.status !== void 0 && args.status !== target.status || args.note !== void 0 && args.note !== target.note || args.deadline !== void 0 && args.deadline !== target.deadline)) return {
				tracks: data.tracks,
				summary: summarize(data),
				changed: false
			};
			if (args.status !== void 0) target.status = args.status;
			if (args.note !== void 0) target.note = args.note;
			if (args.deadline !== void 0) target.deadline = args.deadline;
		}
		target.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
		await writeTrack(root, data);
		return {
			tracks: data.tracks,
			summary: summarize(data),
			changed: true
		};
	}
});
//#endregion
//#region src/ns.ts
/**
* dsh-campus-hunt — settings namespace 身份常量（v0.1）。
*
* 纯常量文件（零 import）：host 半场（config.ts re-export，供 entry /
* installSection / 测试）与 client 半场（设置页卡片的 scope 绑定与 slot id）
* 共用同一个 namespace 字符串。client 半场不能 value-import config.ts——
* 该模块的运行时依赖（schemastery / data/store.ts 的 node: 内建）会被
* client bundle 内联（tsdown.config.ts 的 alwaysBundle 策略），破坏浏览器
* 构建。
*/
/** Settings namespace（小写连字符，满足 parseSettingsNamespace；client 卡片 slot id 同值）。 */
const NS = "campus-hunt";
//#endregion
//#region src/config.ts
/** 默认专场页 URL（27 届秋招正式批专场；v0.1.1 起可经 specialUrl 覆盖）。 */
const DEFAULT_SPECIAL_URL = "https://www.nowcoder.com/jobs/activity/v2/special-activity/index/2027QZzc";
/** 默认配置（cordis.patch.yml entry `config:` 段的同值 YAML；模式解析 `{}` 得同值）。 */
const defaultConfig = {
	profile: {
		directions: [],
		cities: [],
		targetCompanies: []
	},
	resumePath: "",
	specialUrl: DEFAULT_SPECIAL_URL,
	collection: {
		allowedDomains: ["nowcoder.com"],
		maxItemsPerRun: 50,
		minIntervalMs: 1e3
	}
};
const profileShape = {
	directions: z.array(z.string()).default([]),
	cities: z.array(z.string()).default([]),
	targetCompanies: z.array(z.string()).default([])
};
const collectionShape = {
	allowedDomains: z.array(z.string()).default(["nowcoder.com"]),
	maxItemsPerRun: z.number().step(1).min(1).max(50).default(50),
	minIntervalMs: z.number().step(1).min(1e3).max(6e5).default(1e3)
};
/**
* 配置校验模式（settings namespace schema + cordis entry config 校验）。
* 每字段带 default：entry 或用户层缺键时按默认补齐。
*/
const Config = z.object({
	profile: z.object(profileShape).default({
		directions: [],
		cities: [],
		targetCompanies: []
	}),
	resumePath: z.string().default(""),
	specialUrl: z.string().min(1).pattern(/^https?:\/\/\S+$/).default(DEFAULT_SPECIAL_URL),
	collection: z.object(collectionShape).default({
		allowedDomains: ["nowcoder.com"],
		maxItemsPerRun: 50,
		minIntervalMs: 1e3
	})
});
let source = () => defaultConfig;
/**
* 接通当前配置源：apply 置为 entry 值 thunk；settings 挂载后经
* installSection 的 setSource 换成 settings 解析值（base + 用户层）。
* @param next - 返回当前权威配置值的 thunk。
*/
function setSource(next) {
	source = next;
}
/** 当前配置（工具 execute 每次运行读取 → 配置改动下次运行即时生效）。 */
function currentConfig() {
	return source();
}
/**
* 域名白名单校验（host 后缀匹配）：url 的 host 等于白名单条目，或为其
* 子域（如白名单 'nowcoder.com' 放行 www.nowcoder.com，拒绝
* evil-nowcoder.com / nowcoder.com.evil.com）。
* 非 http(s) 协议、不可解析、空白名单条目 → false（白名单外一律拒绝）。
* @param url - 待校验 URL。
* @param allowedDomains - 白名单（host 或域后缀）。
*/
function isDomainAllowed(url, allowedDomains) {
	let parsed;
	try {
		parsed = new URL(url);
	} catch {
		return false;
	}
	if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
	const host = parsed.hostname.toLowerCase();
	return allowedDomains.some((entry) => {
		const domain = entry.trim().toLowerCase();
		return domain !== "" && (host === domain || host.endsWith("." + domain));
	});
}
//#endregion
//#region src/tools/campus-job-search.ts
/**
* dsh-campus-hunt — campus_job_search 工具（v0.1）。
*
* 校招岗位入库：把 agent 按 campus-hunt skill 从牛客秋招专场页提取的岗位数组
* （ego_js 的返回，JSON 字符串或数组两种形态都接受）合并进会话
* workspace 下 jobs.json。**不碰网络**——raw 由 skill 工作流提供。
*
* 合并规则（v0.1 口径）：
*   - 规范化：所有文本 trim；缺 id/title/company（或非对象元素）的条目
*     跳过并计入 skipped
*   - filter（入库前）：query 忽略大小写匹配 company/title 任一；
*     city 对 city 字段包含匹配；两者同时给 = AND；空串视为无约束。
*     被过滤掉的条目不入库、不计入 skipped。
*   - 按 id 去重：新 id 追加（计入 merged）；已存在 id 用新值覆盖可变字段
*     （company/title/city/salary/degree/url——新值缺失即清除该字段）
*     并刷新 fetchedAt（计入 duplicates）。
*   - deadline 不由本工具写入（Job schema 保留该字段，留给后续
*     详情采集工具；raw 中的 deadline 忽略）。
*   - fetchedAt = 每次合并时 new Date().toISOString()。
*   - v0.1（采集红线，settings 配置 collection）：raw 超过
*     maxItemsPerRun → 截断，返回可选 truncated（>0 才出现）；job.url
*     域名不在 allowedDomains（host 后缀匹配；无 url 的条目放行）→
*     跳过并计入可选 rejectedDomains（>0 才出现）。
*   - v0.1.1（画像直供，free-search 模式）：结果恒带 profile
*     （directions/cities/targetCompanies 三字符串数组，不含 resumePath）——
*     host 侧每次 execute 活读 currentConfig()，无 workspace 副本，设置页
*     改动下次运行即生效；render 追加一行画像（任一类目非空 →
*     「当前画像：方向 a/b · 城市 c · 目标公司 d」，全空 →
*     「画像未设置（要个性化推荐请在设置页填写）」），供 agent 推荐流程
*     直接消费（raw=[] 查询调用 = 全量 jobs + 当前画像，零副作用）。
*   - v0.1.1（skip-write 守卫）：merged===0 && duplicates===0 →
*     跳过 writeJobs（jobs.json 内容与 mtime 稳定；raw=[] 查询调用真正
*     零副作用）。
*
* workspace 归属：exec.agent.session.header.cwd（与 job_track 同一契约，
* v0.1 口径）；非 agent 调用无会话 workspace → execute 抛错（isError）。
*/
/**
* 画像行（v0.1.1）：任一类目非空 →「当前画像：方向 a/b · 城市 c ·
* 目标公司 d」（同类目多 tag 以 `/` 连接、空类目整段省略、类目间 ` · `）；
* 三类目全空 →「画像未设置（要个性化推荐请在设置页填写）」（逐字口径）。
*/
function renderProfileLine(profile) {
	const segments = [];
	if (profile.directions.length > 0) segments.push(`方向 ${profile.directions.join("/")}`);
	if (profile.cities.length > 0) segments.push(`城市 ${profile.cities.join("/")}`);
	if (profile.targetCompanies.length > 0) segments.push(`目标公司 ${profile.targetCompanies.join("/")}`);
	if (segments.length === 0) return "画像未设置（要个性化推荐请在设置页填写）";
	return `当前画像：${segments.join(" · ")}`;
}
/** 模型可见的紧凑渲染（与存储一致）。 */
function renderJobSearchResult(value) {
	const extras = [];
	if (value.truncated !== void 0 && value.truncated > 0) extras.push(`按单轮上限截断 ${value.truncated} 条未入库`);
	if (value.rejectedDomains !== void 0 && value.rejectedDomains > 0) extras.push(`${value.rejectedDomains} 条域名不在白名单被跳过`);
	const head = `岗位库现有 ${value.jobs.length} 条（本次新增 ${value.merged}，覆盖 ${value.duplicates}，跳过 ${value.skipped}${extras.length > 0 ? `，${extras.join("，")}` : ""}）`;
	let base;
	if (value.jobs.length === 0) base = head + "。";
	else base = `${head}：\n${value.jobs.map((j) => {
		const extras = [];
		if (j.city !== void 0) extras.push(j.city);
		if (j.salary !== void 0) extras.push(j.salary);
		if (j.degree !== void 0) extras.push(j.degree);
		return `- ${j.company} · ${j.title}${extras.length > 0 ? `（${extras.join(" / ")}）` : ""}`;
	}).join("\n")}`;
	if (value.profile === void 0) return base;
	return `${base}\n${renderProfileLine(value.profile)}`;
}
/**
* 卡片投影（v0.1）：规范值 → 可回放 JSON（client 回答区三 tab 卡片的
* 分支依据）。纯投影：只含规范值字段，不含 UI 状态（activeTab/selected 等）
* 与 React props；jobs 元素原样透传（registry 边界已按 output schema 校验，
* client 侧逐条再校验容忍 partial/坏元素）。
*
* value 非对象（脏值，仅直接调用可达；registry 路径先过 schema）→
* `{ card: null }` 等价"不支持"投影，client 回退 generic 行。
*/
function projectJobsCard(value) {
	if (typeof value !== "object" || value === null || Array.isArray(value)) return {
		card: null,
		tool: "campus_job_search",
		jobs: [],
		merged: 0,
		duplicates: 0
	};
	const v = value;
	return {
		card: "jobs",
		tool: "campus_job_search",
		jobs: Array.isArray(v.jobs) ? v.jobs : [],
		merged: typeof v.merged === "number" ? v.merged : 0,
		duplicates: typeof v.duplicates === "number" ? v.duplicates : 0
	};
}
/** 文本规范化：非字符串/空串 → undefined，否则 trim 后返回。 */
function cleanText(value) {
	if (typeof value !== "string") return void 0;
	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : void 0;
}
/**
* 规范化单条 raw 元素。
* @returns 规范化岗位；非对象或缺 id/title/company 时返回 null（调用方计入 skipped）。
*/
function normalizeRecord(record) {
	if (typeof record !== "object" || record === null || Array.isArray(record)) return null;
	const obj = record;
	const id = cleanText(obj.id);
	const company = cleanText(obj.company);
	const title = cleanText(obj.title);
	if (id === void 0 || company === void 0 || title === void 0) return null;
	const job = {
		id,
		company,
		title
	};
	const city = cleanText(obj.city);
	if (city !== void 0) job.city = city;
	const salary = cleanText(obj.salary);
	if (salary !== void 0) job.salary = salary;
	const degree = cleanText(obj.degree);
	if (degree !== void 0) job.degree = degree;
	const url = cleanText(obj.url);
	if (url !== void 0) job.url = url;
	return job;
}
/**
* raw 双形态：JSON 字符串（ego_js 原样返回）或数组，统一为元素数组。
* 入参在 defineTool 层按 oneOf（array | string）校验；此处收窄并拒绝非法形态。
*/
function normalizeRaw$1(raw) {
	if (typeof raw === "string") {
		let parsed;
		try {
			parsed = JSON.parse(raw);
		} catch (error) {
			throw new Error(`campus_job_search: raw 是 JSON 字符串但解析失败：${String(error)}`);
		}
		if (!Array.isArray(parsed)) throw new Error("campus_job_search: raw 的 JSON 字符串解析结果必须是数组");
		return parsed;
	}
	if (!Array.isArray(raw)) throw new Error("campus_job_search: raw 必须是数组或 JSON 字符串");
	return raw;
}
/** 入库前过滤：query 忽略大小写匹配 company/title 任一；city 包含匹配；两者 AND；空串无约束。 */
function passesFilter(job, filter) {
	if (filter === void 0) return true;
	const query = filter.query?.trim().toLowerCase();
	if (query !== void 0 && query.length > 0) {
		if (!job.company.toLowerCase().includes(query) && !job.title.toLowerCase().includes(query)) return false;
	}
	const city = filter.city?.trim();
	if (city !== void 0 && city.length > 0) {
		if (job.city === void 0 || !job.city.includes(city)) return false;
	}
	return true;
}
const campusJobSearchTool = defineTool({
	name: "campus_job_search",
	description: "校招岗位入库（纯本地，无网络）。把从牛客秋招专场页提取的岗位数组（ego_js 返回的 JSON 字符串，或岗位对象数组）合并进会话 workspace 的 jobs.json：按 id 去重（新 id 追加，已存在 id 覆盖可变字段并刷新 fetchedAt）。可选 filter 在入库前过滤：query 忽略大小写匹配公司/岗位名任一，city 对城市字段包含匹配，两者同时给为 AND。raw 超过单轮上限时截断（返回 truncated 计数）；job.url 域名不在白名单时跳过（返回 rejectedDomains 计数）。返回合并后全量 jobs 与 merged/duplicates/skipped 计数，以及当前求职画像 profile（v0.1.1：settings 直供、不含 resumePath；raw=[] 的查询调用零副作用）。",
	parameters: {
		raw: {
			oneOf: [{
				type: "array",
				items: { type: "json" },
				description: "岗位对象数组，元素字段 id/company/title/city/salary/degree/url（缺失字段省略）。"
			}, {
				type: "string",
				description: "上述数组的 JSON 字符串（ego_js 的返回原样传入即可）。"
			}],
			required: true,
			description: "待入库的岗位数据：数组或 JSON 字符串两种形态都接受。"
		},
		filter: {
			type: "object",
			additionalProperties: false,
			properties: {
				query: {
					type: "string",
					description: "关键词：忽略大小写匹配公司名或岗位名任一（空串视为无约束）。"
				},
				city: {
					type: "string",
					description: "城市：对岗位 city 字段做包含匹配（空串视为无约束）。"
				}
			},
			description: "可选入库前过滤；query 与 city 同时给时为 AND。"
		}
	},
	output: {
		schema: {
			type: "object",
			additionalProperties: false,
			properties: {
				jobs: {
					type: "array",
					required: true,
					items: {
						type: "object",
						additionalProperties: false,
						properties: {
							id: {
								type: "string",
								required: true
							},
							company: {
								type: "string",
								required: true
							},
							title: {
								type: "string",
								required: true
							},
							city: { type: "string" },
							salary: { type: "string" },
							degree: { type: "string" },
							deadline: { type: "string" },
							graduationYear: { type: "string" },
							url: { type: "string" },
							fetchedAt: {
								type: "string",
								required: true
							},
							jd: {
								type: "object",
								additionalProperties: false,
								properties: {
									description: {
										type: "array",
										required: true,
										items: { type: "string" }
									},
									requirements: {
										type: "array",
										required: true,
										items: { type: "string" }
									},
									bonus: {
										type: "array",
										items: { type: "string" }
									}
								}
							}
						}
					}
				},
				merged: {
					type: "integer",
					required: true
				},
				duplicates: {
					type: "integer",
					required: true
				},
				skipped: {
					type: "integer",
					required: true
				},
				truncated: {
					type: "integer",
					description: "被单轮上限截断丢弃的条目数（>0 才出现）。"
				},
				rejectedDomains: {
					type: "integer",
					description: "job.url 域名不在白名单而被跳过的条目数（>0 才出现）。"
				},
				profile: {
					type: "object",
					additionalProperties: false,
					properties: {
						directions: {
							type: "array",
							required: true,
							items: { type: "string" }
						},
						cities: {
							type: "array",
							required: true,
							items: { type: "string" }
						},
						targetCompanies: {
							type: "array",
							required: true,
							items: { type: "string" }
						}
					}
				}
			}
		},
		render: (_args, value) => [{
			type: "text",
			text: renderJobSearchResult(value)
		}],
		presentationMeta: (_args, value) => projectJobsCard(value)
	},
	async execute(args, exec) {
		const root = resolveWorkspaceRoot(exec.agent?.session?.header?.cwd);
		await assertWorkspaceRoot(root);
		exec.signal.throwIfAborted();
		const cfg = currentConfig();
		const records = normalizeRaw$1(args.raw);
		let truncated = 0;
		const limit = cfg.collection.maxItemsPerRun;
		const limited = records.length > limit ? (truncated = records.length - limit, records.slice(0, limit)) : records;
		const data = await readJobs(root);
		const now = (/* @__PURE__ */ new Date()).toISOString();
		let merged = 0;
		let duplicates = 0;
		let skipped = 0;
		let rejectedDomains = 0;
		for (const record of limited) {
			const norm = normalizeRecord(record);
			if (norm === null) {
				skipped += 1;
				continue;
			}
			if (norm.url !== void 0 && !isDomainAllowed(norm.url, cfg.collection.allowedDomains)) {
				rejectedDomains += 1;
				continue;
			}
			if (!passesFilter(norm, args.filter)) continue;
			const existing = data.jobs.find((j) => j.id === norm.id);
			if (existing === void 0) {
				data.jobs.push({
					...norm,
					fetchedAt: now
				});
				merged += 1;
			} else {
				existing.company = norm.company;
				existing.title = norm.title;
				for (const key of [
					"city",
					"salary",
					"degree",
					"url"
				]) {
					const value = norm[key];
					if (value === void 0) delete existing[key];
					else existing[key] = value;
				}
				existing.fetchedAt = now;
				duplicates += 1;
			}
		}
		if (merged > 0 || duplicates > 0) await writeJobs(root, data);
		exec.signal.throwIfAborted();
		const result = {
			jobs: data.jobs,
			merged,
			duplicates,
			skipped
		};
		if (truncated > 0) result.truncated = truncated;
		if (rejectedDomains > 0) result.rejectedDomains = rejectedDomains;
		result.profile = {
			directions: [...cfg.profile.directions],
			cities: [...cfg.profile.cities],
			targetCompanies: [...cfg.profile.targetCompanies]
		};
		return result;
	}
});
//#endregion
//#region src/tools/campus-job-detail.ts
/**
* dsh-campus-hunt — campus_job_detail 工具（v0.1）。
*
* 岗位 JD 详情入库：把 agent 按 campus-hunt skill 从牛客岗位详情页
* （/jobs/detail/<id>）提取的 JD 对象（ego_js 的返回，JSON 字符串或对象
* 两种形态都接受）合并进会话 workspace 下 jobs.json 的既有岗位记录。
* **不碰网络**——raw 由 skill 工作流提供。
*
* 合并规则（v0.1 口径，协调者决策 3）：
*   - jobId 必须已在 jobs.json 中：不存在 → 抛错（提示先用
*     campus_job_search 采集该岗位）。
*   - job.jd = 解析结果 { description, requirements, bonus? }（bonus 为空
*     时省略）；覆盖既有 jd（本次 raw 是最新来源）。
*   - raw 若带 deadline（ISO YYYY-MM-DD）→ 覆盖 job.deadline；未带则
*     保留既有值。
*   - 刷新 job.fetchedAt = new Date().toISOString()，写回 jobs.json。
*   - raw 若带 graduationYear（非空原文）→ 覆盖
*     job.graduationYear；未带则保留既有值（与 deadline 同「有则覆盖、
*     无则保留」语义，v0.1 字段扩展修正）。
*   - 返回 { job: 更新后的完整 Job 记录, jd: 解析结果 }。
*
* 校验：
*   - raw 须含非空 description[] 或 requirements[]（否则抛错——提取结果
*     无效，多半是页面结构变化）。
*   - raw 为字符串时必须是合法 JSON 对象；非对象形态抛错（不静默回退）。
*   - deadline 若给必须是 ISO YYYY-MM-DD 字符串（表达式内已换算；
*     给非 ISO 值大声报错，不写入脏数据）。
*   - graduationYear 若给必须是非空字符串（毕业要求原文；
*     给非字符串/空串大声报错，不写入脏数据）。
*
* workspace 归属：exec.agent.session.header.cwd（与 campus_job_search 同一
* 契约）；非 agent 调用无会话 workspace → execute 抛错（isError）。
*
* v0.1（采集红线，settings 配置 collection）：raw.url 存在则校验
* allowedDomains 白名单（host 后缀匹配）；不在白名单 → 错误返回（提示模型，
* 数据不入库）；raw.url 不存在 → 放行。
*/
/** 模型可见的紧凑渲染（与存储一致）。 */
function renderJobDetailResult(value) {
	const j = value.job;
	const parts = [`${value.jd.description.length} 条职责`, `${value.jd.requirements.length} 条要求`];
	if (value.jd.bonus !== void 0) parts.push(`${value.jd.bonus.length} 条加分项`);
	const deadline = j.deadline !== void 0 ? `，截止 ${j.deadline}` : "";
	return `JD 已入库：${j.company} · ${j.title}（${parts.join("，")}${deadline}）`;
}
/**
* 卡片投影（v0.1）：规范值 + args.jobId → 可回放 JSON（card:'job'）。
* job 为含 jd 的完整 Job，原样透传（registry 边界已按 output schema 校验，
* client 侧再校验）。value 非对象（脏值，仅直接调用可达）→ `{ card: null }`
* 等价"不支持"投影，client 回退 generic 行。
*/
function projectJobCard(args, value) {
	const a = typeof args === "object" && args !== null ? args : {};
	const jobId = typeof a.jobId === "string" ? a.jobId : null;
	if (typeof value !== "object" || value === null || Array.isArray(value)) return {
		card: null,
		tool: "campus_job_detail",
		jobId,
		job: null
	};
	const v = value;
	return {
		card: "job",
		tool: "campus_job_detail",
		jobId,
		job: v.job !== null && typeof v.job === "object" && !Array.isArray(v.job) ? v.job : null
	};
}
/** 文本行数组规范化：非数组 → undefined；逐元素 trim、去空后为空 → undefined。 */
function cleanLines(value) {
	if (!Array.isArray(value)) return void 0;
	const lines = value.map((v) => typeof v === "string" ? v.trim() : "").filter((l) => l !== "");
	return lines.length > 0 ? lines : void 0;
}
/**
* raw 双形态：JSON 字符串（ego_js 原样返回）或对象，统一为对象。
* 入参在 defineTool 层按 oneOf（object | string）校验；此处收窄并拒绝非法形态。
*/
function parseRaw(raw) {
	if (typeof raw === "string") {
		let parsed;
		try {
			parsed = JSON.parse(raw);
		} catch (error) {
			throw new Error(`campus_job_detail: raw 是 JSON 字符串但解析失败：${String(error)}`);
		}
		if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new Error("campus_job_detail: raw 的 JSON 字符串解析结果必须是对象（JD 字段）");
		return parsed;
	}
	if (typeof raw !== "object" || raw === null || Array.isArray(raw)) throw new Error("campus_job_detail: raw 必须是对象或 JSON 字符串");
	return raw;
}
/**
* 解析/校验 raw → 规范 JD + 可选 deadline + 可选 graduationYear。
* @returns { jd, deadline?, graduationYear? }；description 与 requirements 全空时抛错。
*/
function normalizeJd(raw) {
	const description = cleanLines(raw.description);
	const requirements = cleanLines(raw.requirements);
	if (description === void 0 && requirements === void 0) throw new Error("campus_job_detail: raw 必须含非空 description[] 或 requirements[]（提取结果无效，页面结构可能已变化）");
	const jd = {
		description: description ?? [],
		requirements: requirements ?? []
	};
	const bonus = cleanLines(raw.bonus);
	if (bonus !== void 0) jd.bonus = bonus;
	let deadline;
	if (raw.deadline !== void 0) {
		if (typeof raw.deadline !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(raw.deadline.trim())) throw new Error(`campus_job_detail: raw.deadline 必须是 ISO YYYY-MM-DD 字符串，收到 ${JSON.stringify(raw.deadline)}`);
		deadline = raw.deadline.trim();
	}
	let graduationYear;
	if (raw.graduationYear !== void 0) {
		if (typeof raw.graduationYear !== "string" || raw.graduationYear.trim() === "") throw new Error(`campus_job_detail: raw.graduationYear 必须是非空字符串（毕业要求原文），收到 ${JSON.stringify(raw.graduationYear)}`);
		graduationYear = raw.graduationYear.trim();
	}
	return {
		jd,
		deadline,
		graduationYear
	};
}
const campusJobDetailTool = defineTool({
	name: "campus_job_detail",
	description: "岗位 JD 详情入库（纯本地，无网络）。把从牛客岗位详情页提取的 JD 对象（ego_js 返回的 JSON 字符串，或 { description/requirements/bonus?/deadline?/graduationYear? } 对象）合并进会话 workspace 的 jobs.json：jobId 必须已存在（不存在时报错，提示先用 campus_job_search 采集该岗位），写入 job.jd、覆盖 deadline（若 raw 带 ISO 截止日）、覆盖 graduationYear（若 raw 带毕业要求原文；raw 未带则保留既有值）、刷新 fetchedAt。返回 { job: 更新后的完整记录, jd: 解析结果 }。",
	parameters: {
		raw: {
			oneOf: [{
				type: "object",
				additionalProperties: true,
				description: "JD 对象：description[]/requirements[]（至少一者非空）、bonus?[]、deadline?（ISO YYYY-MM-DD）、graduationYear?（毕业要求原文）。"
			}, {
				type: "string",
				description: "上述对象的 JSON 字符串（ego_js 的返回原样传入即可）。"
			}],
			required: true,
			description: "待入库的 JD 数据：对象或 JSON 字符串两种形态都接受。"
		},
		jobId: {
			type: "string",
			required: true,
			description: "牛客岗位 id（jobs.json 主键，即列表页 href 的 jobId= 参数）。"
		}
	},
	output: {
		schema: {
			type: "object",
			additionalProperties: false,
			properties: {
				job: {
					type: "object",
					additionalProperties: false,
					required: true,
					properties: {
						id: {
							type: "string",
							required: true
						},
						company: {
							type: "string",
							required: true
						},
						title: {
							type: "string",
							required: true
						},
						city: { type: "string" },
						salary: { type: "string" },
						degree: { type: "string" },
						deadline: { type: "string" },
						graduationYear: { type: "string" },
						url: { type: "string" },
						fetchedAt: {
							type: "string",
							required: true
						},
						jd: {
							type: "object",
							additionalProperties: false,
							required: true,
							properties: {
								description: {
									type: "array",
									required: true,
									items: { type: "string" }
								},
								requirements: {
									type: "array",
									required: true,
									items: { type: "string" }
								},
								bonus: {
									type: "array",
									items: { type: "string" }
								}
							}
						}
					}
				},
				jd: {
					type: "object",
					additionalProperties: false,
					required: true,
					properties: {
						description: {
							type: "array",
							required: true,
							items: { type: "string" }
						},
						requirements: {
							type: "array",
							required: true,
							items: { type: "string" }
						},
						bonus: {
							type: "array",
							items: { type: "string" }
						}
					}
				}
			}
		},
		render: (_args, value) => [{
			type: "text",
			text: renderJobDetailResult(value)
		}],
		presentationMeta: (args, value) => projectJobCard(args, value)
	},
	async execute(args, exec) {
		const root = resolveWorkspaceRoot(exec.agent?.session?.header?.cwd);
		await assertWorkspaceRoot(root);
		exec.signal.throwIfAborted();
		const parsed = parseRaw(args.raw);
		const rawUrl = typeof parsed.url === "string" ? parsed.url.trim() : "";
		if (rawUrl !== "") {
			const cfg = currentConfig();
			if (!isDomainAllowed(rawUrl, cfg.collection.allowedDomains)) throw new Error(`campus_job_detail: 岗位 url ${rawUrl} 不在采集白名单（当前允许：${cfg.collection.allowedDomains.join(" / ")}）；本次数据不入库。请改从白名单内的页面重新采集，或在设置页检查 campus-hunt 的 collection.allowedDomains 配置。`);
		}
		const { jd, deadline, graduationYear } = normalizeJd(parsed);
		const data = await readJobs(root);
		const jobId = args.jobId.trim();
		const job = data.jobs.find((j) => j.id === jobId);
		if (job === void 0) throw new Error(`campus_job_detail: jobs.json 中没有岗位 id ${jobId}；请先用 campus_job_search 采集该岗位（列表入库后）再取 JD 详情`);
		job.jd = jd;
		if (deadline !== void 0) job.deadline = deadline;
		if (graduationYear !== void 0) job.graduationYear = graduationYear;
		job.fetchedAt = (/* @__PURE__ */ new Date()).toISOString();
		await writeJobs(root, data);
		exec.signal.throwIfAborted();
		return {
			job: {
				...job,
				jd
			},
			jd
		};
	}
});
//#endregion
//#region src/tools/campus-schedule.ts
/**
* dsh-campus-hunt — campus_schedule 工具（v0.1）。
*
* 校招日程入库：把 agent 按 campus-hunt skill 从牛客校招日程页
* （/jobs/school/schedule）提取的公司卡数组（ego_js 的返回，JSON 字符串
* 或数组两种形态都接受）合并进会话 workspace 下 schedule.json。
* **不碰网络**——raw 由 skill 工作流提供。
*
* 映射规则（v0.1 口径，ScheduleItem 适配真实页面）：
*   company    = raw 元素 company 原样（必填，空则抛错）
*   type       = batch 原文（站点批次标签原样，如「网申中」）；
*                无 batch 的卡 → type = '未知'
*   openDate   = recordedDate（MM.dd 原文）补**当年** → ISO YYYY-MM-DD
*                （当年 = new Date().getFullYear()；如 07.28 → 2026-07-28）；
*                无 recordedDate（「正在收集中」形态）→ 省略
*   source     = 固定日程页 URL https://www.nowcoder.com/jobs/school/schedule
*   cities     = 「地点：」后的城市串原文（如「杭州、深圳、北京」）
*                → ScheduleItem.cities；无 cities 的卡 → 省略
*                （v0.1 字段扩展修正）
*
* 合并规则（协调者决策 4）：
*   - 按 company 去重：新 company 追加；已存在 → 覆盖 type/openDate/cities
*     （raw 无 recordedDate/cities 时清除对应既有值——与 campus_job_search
*     「新值缺失即清除」的覆盖语义一致），source 保持既有值。
*   - 返回 { items: 合并后全量, source }。
*
* 校验：非对象元素或 company 为空的元素、recordedDate 非 MM.dd 形态、
* cities 非字符串或空串 → 抛错（不静默跳过——raw 来自受控表达式，
* 脏输入应大声暴露）。
*
* workspace 归属：exec.agent.session.header.cwd（与 campus_job_search 同一
* 契约）；非 agent 调用无会话 workspace → execute 抛错（isError）。
*
* v0.1（采集红线，settings 配置 collection）：raw 元素携带 url 则校验
* allowedDomains 白名单（host 后缀匹配）；任一不在白名单 → 错误返回（提示
* 模型，数据不入库）；元素无 url → 放行。
*/
/** 日程来源（固定）：牛客校招日程页。 */
const SCHEDULE_SOURCE = "https://www.nowcoder.com/jobs/school/schedule";
/** 无 batch 标签的公司卡的 type 值（v0.1 口径）。 */
const UNKNOWN_BATCH = "未知";
/** 模型可见的紧凑渲染（与存储一致）。 */
function renderScheduleResult(value) {
	if (value.items.length === 0) return "校招日程为空：还没有收录任何公司。";
	const lines = value.items.map((it) => {
		const date = it.openDate !== void 0 ? `，${it.openDate} 开放` : "";
		return `- ${it.company}（${it.type}${date}）`;
	});
	return `校招日程共 ${value.items.length} 家：\n${lines.join("\n")}`;
}
/**
* 卡片投影（v0.1）：规范值 → 可回放 JSON（card:'schedule'）。纯投影：
* items 原样透传（registry 边界已按 output schema 校验，client 侧逐条再校验）；
* value 非对象（脏值，仅直接调用可达）→ `{ card: null }`，client 回退 generic 行。
*/
function projectScheduleCard(value) {
	if (typeof value !== "object" || value === null || Array.isArray(value)) return {
		card: null,
		tool: "campus_schedule",
		items: [],
		source: ""
	};
	const v = value;
	return {
		card: "schedule",
		tool: "campus_schedule",
		items: Array.isArray(v.items) ? v.items : [],
		source: typeof v.source === "string" ? v.source : ""
	};
}
/**
* raw 双形态：JSON 字符串（ego_js 原样返回）或数组，统一为元素数组。
* 入参在 defineTool 层按 oneOf（array | string）校验；此处收窄并拒绝非法形态。
*/
function normalizeRaw(raw) {
	let list;
	if (typeof raw === "string") {
		let parsed;
		try {
			parsed = JSON.parse(raw);
		} catch (error) {
			throw new Error(`campus_schedule: raw 是 JSON 字符串但解析失败：${String(error)}`);
		}
		if (!Array.isArray(parsed)) throw new Error("campus_schedule: raw 的 JSON 字符串解析结果必须是数组");
		list = parsed;
	} else if (Array.isArray(raw)) list = raw;
	else throw new Error("campus_schedule: raw 必须是数组或 JSON 字符串");
	return list;
}
/** MM.dd（如 07.28）补当年 → ISO YYYY-MM-DD（当年 = new Date().getFullYear()）。 */
function recordedDateToIso(recordedDate) {
	const m = recordedDate.match(/^(\d{2})\.(\d{2})$/);
	if (m === null) throw new Error(`campus_schedule: recordedDate 必须是 MM.dd 原文（如 07.28），收到 ${JSON.stringify(recordedDate)}`);
	return `${(/* @__PURE__ */ new Date()).getFullYear()}-${m[1]}-${m[2]}`;
}
/**
* 规范化单条 raw 元素 → ScheduleItem（openDate 无 recordedDate 时省略，
* cities 无该键时省略）。
* @throws 非对象元素 / company 为空 / recordedDate 非 MM.dd 形态 /
* cities 非字符串或空串。
*/
function normalizeItem(item) {
	if (typeof item !== "object" || item === null || Array.isArray(item)) throw new Error(`campus_schedule: raw 元素必须是对象，收到 ${JSON.stringify(item)}`);
	const obj = item;
	const company = typeof obj.company === "string" ? obj.company.trim() : "";
	if (company === "") throw new Error("campus_schedule: raw 元素缺 company（无公司名的卡应在提取表达式侧跳过）");
	const batch = typeof obj.batch === "string" ? obj.batch.trim() : "";
	const result = {
		company,
		type: batch !== "" ? batch : UNKNOWN_BATCH,
		source: SCHEDULE_SOURCE
	};
	if (obj.recordedDate !== void 0) result.openDate = recordedDateToIso(String(obj.recordedDate));
	if (obj.cities !== void 0) {
		if (typeof obj.cities !== "string" || obj.cities.trim() === "") throw new Error(`campus_schedule: raw 元素 cities 必须是非空字符串（地点城市串原文），收到 ${JSON.stringify(obj.cities)}`);
		result.cities = obj.cities.trim();
	}
	return result;
}
const campusScheduleTool = defineTool({
	name: "campus_schedule",
	description: "校招日程入库（纯本地，无网络）。把从牛客校招日程页提取的公司卡数组（ego_js 返回的 JSON 字符串，或 { company/batch?/recordedDate?/cities? } 对象数组）合并进会话 workspace 的 schedule.json：按 company 去重（新 company 追加，已存在覆盖 type/openDate/cities、保持 source）；batch 原文作 type（无 batch 记「未知」），recordedDate（MM.dd）补当年换算 ISO 作 openDate（无则省略），cities 地点城市串原文入库（无则省略，既有值随之清除）。返回 { items: 合并后全量, source }。",
	parameters: { raw: {
		oneOf: [{
			type: "array",
			items: { type: "json" },
			description: "公司卡对象数组，元素字段 company（必填）/ batch?（批次标签原文）/ recordedDate?（MM.dd 原文）/ cities?（地点城市串原文）。"
		}, {
			type: "string",
			description: "上述数组的 JSON 字符串（ego_js 的返回原样传入即可）。"
		}],
		required: true,
		description: "待入库的日程数据：数组或 JSON 字符串两种形态都接受。"
	} },
	output: {
		schema: {
			type: "object",
			additionalProperties: false,
			properties: {
				items: {
					type: "array",
					required: true,
					items: {
						type: "object",
						additionalProperties: false,
						properties: {
							company: {
								type: "string",
								required: true
							},
							openDate: { type: "string" },
							type: {
								type: "string",
								required: true
							},
							cities: { type: "string" },
							source: {
								type: "string",
								required: true
							}
						}
					}
				},
				source: {
					type: "string",
					required: true
				}
			}
		},
		render: (_args, value) => [{
			type: "text",
			text: renderScheduleResult(value)
		}],
		presentationMeta: (_args, value) => projectScheduleCard(value)
	},
	async execute(args, exec) {
		const root = resolveWorkspaceRoot(exec.agent?.session?.header?.cwd);
		await assertWorkspaceRoot(root);
		exec.signal.throwIfAborted();
		const list = normalizeRaw(args.raw);
		const cfg = currentConfig();
		for (const element of list) {
			if (typeof element !== "object" || element === null || Array.isArray(element)) continue;
			const obj = element;
			const url = typeof obj.url === "string" ? obj.url.trim() : "";
			if (url !== "" && !isDomainAllowed(url, cfg.collection.allowedDomains)) {
				const who = typeof obj.company === "string" && obj.company.trim() !== "" ? `（${obj.company.trim()}）` : "";
				throw new Error(`campus_schedule: raw 元素${who}携带 url ${url} 不在采集白名单（当前允许：${cfg.collection.allowedDomains.join(" / ")}）；本次数据不入库。请改从白名单内的页面重新提取，或在设置页检查 campus-hunt 的 collection.allowedDomains 配置。`);
			}
		}
		const items = list.map(normalizeItem);
		const data = await readSchedule(root);
		for (const item of items) {
			const existing = data.items.find((it) => it.company === item.company);
			if (existing === void 0) data.items.push(item);
			else {
				existing.type = item.type;
				if (item.openDate !== void 0) existing.openDate = item.openDate;
				else delete existing.openDate;
				if (item.cities !== void 0) existing.cities = item.cities;
				else delete existing.cities;
			}
		}
		await writeSchedule(root, data);
		exec.signal.throwIfAborted();
		return {
			items: data.items,
			source: SCHEDULE_SOURCE
		};
	}
});
//#endregion
//#region src/nowcoder/extract.ts
/**
* dsh-campus-hunt — 牛客秋招专场页提取/导航表达式（v0.1）。
* v0.1 追加：EXTRACT_JD_EXPRESSION（岗位详情页 JD）与
* EXTRACT_SCHEDULE_EXPRESSION（校招日程页）——见下方各自注释。
*
* 目标页面：秋招正式批**专场页**
*   https://www.nowcoder.com/jobs/activity/v2/special-activity/index/2027QZzc
* 专场页 JS 渲染（web_fetch 拿不到岗位数据），采集必须经 DSH 浏览器采集后端
* （dsh-ego-browser）工具的 ego_js 在页面内执行表达式。本模块导出**自包含 JS 表达式字符串**
* （IIFE，除 document 外不引用任何外部变量/导入），由 campus-hunt skill
* 原样嵌入工作流指令；测试用 jsdom document 对同一字符串求值验证映射规则。
*
* 为何废弃旧 line-one 结构（v0.1 初版，2026-09-04 实测口径）：
*   旧表达式针对列表页 https://www.nowcoder.com/jobs/school/jobs 的
*   `div.line-one > a.job-message-boxs` 卡片，但该结构只存在于「全部职位」
*   tab——混入往届等历史批次岗位，且 Job schema 无届字段无法区分；
*   匿名态点「秋招正式批」tab 得到的只是企业总览墙（div.activity-box，
*   13 家 ac-company-card）+ 登录弹窗，**没有岗位列表**。真实岗位列表
*   在专场页「热招职位」区块内（2026-09-04 实测确认）。
*
* 真实 DOM 结构（2026-07-20 复测，v0.1.1；取代 2026-09-04 侦察记录）：
*   div.ac-job-wrap > div.section-body > div.job-list > a.job-item × 40
*   每张岗位卡 = 一个 `<a class="job-item">`（href 形如
*   /jobs/company-project?projectId=…&jobId=<id>&activitySuffix=2027QZzc&…），
*   内嵌 `div.recommend-job-card`，card 的直系 div 子节点固定三行（2026-07-20
*   40 卡实测未变）：
*     行 0（标题行）：首个 div = 岗位标题；末个 div = 薪资
*                    （class 含 tw-text-[#ff561b] 橙色）
*     行 1（标签行）：.tag-item 序列——实测恒 2 个：首个 = 城市
*                    （可组合串，如"北京/上海/广州/成都/西安/石家庄"），
*                    第二个 = 学历要求（本科 / 硕士 / 不限 …；可只有 1 个）
*     行 2（公司行）：img（公司 logo）后的 span = 公司名
*   专场页新增 filter-wrap 筛选 UI（职位类型 / 工作地点，含「展开更多」折叠钮）；
*   tab 计数随届次变化（2026-07-20 实测 热招企业(15) / 热招职位(697)），但第一屏
*   仍只渲染 40 张卡、无「加载更多」/分页控件（滚动验证无懒加载）。
*   注：类名是 .recommend-job-card（2026-09-04 侦察与 2026-07-20 复测一致）；
*   「.recruitment-job-card」从未出现在页面上（0 命中），系验证轮记录笔误。
*
* 字段映射规则（v0.1 口径）：
*   id      = href 中 jobId= 查询参数的纯数字串
*   url     = https://www.nowcoder.com/jobs/detail/<id>（2026-09-04 实测
*             匿名可开，标题/公司/城市/学历与列表卡片一致——canonical 形态）
*   title   = 行 0 首个 div 文本（trim；"&amp;" 实体解码、尾部空白去除）
*   salary  = 行 0 末个 div 文本（trim；"薪资面议"/"10-16K * 12薪" 原样保留）
*   company = 行 2 内首个 span 文本（trim）
*   city    = .tag-item 中**首个不含学历特征**的项（城市可能是组合串，原样保留）
*   degree  = .tag-item 中**首个匹配 /本科|专科|硕士|博士|不限/ 的项**
*             （"不限" = 无学历要求，是学历槽位的真实取值，输出；
*             若某卡只有城市标签，degree 省略）
*   缺 id/title/company 的卡片跳过。
*   输出为 JSON 字符串：岗位对象数组，缺失字段省略（对象键序
*   id, company, title, city, salary, degree, url）。
*
* 导航表达式（列表页/专场页共用，ego_js 执行）：
*   CLICK_ACTIVITY_TAB_EXPRESSION    列表页：点「秋招正式批」tab →
*                                    出现 div.activity-box 总览（无岗位列表）
*   GET_ACTIVITY_DETAIL_HREF_EXPRESSION 总览卡 div.activity-info 内读
*                                    a.detail「查看详情」href 并去 query
*                                    规范化（该链接 target=_blank，ego 浏览器
*                                    单页会话不能直接点开新 tab，故读 href 后
*                                    ego_navigate）
*   CLICK_HOT_TAB_EXPRESSION         专场页：点「热招职位」区块
*                                    （div.tab-bar span[data-tab]，默认停在
*                                    「热招企业」tab，不点则无岗位列表）
*   注：专场页会弹登录弹窗（.v-modal + .login-dialog）——只按 Escape 关闭，
*   不登录；JS .click() 不受弹窗遮挡影响（实测验证）。
*/
/** ego_js 执行后返回 JSON 字符串：专场页「热招职位」列表的岗位对象数组。 */
const EXTRACT_LIST_EXPRESSION = `(() => {
  var cards = Array.from(document.querySelectorAll("a.job-item"));
  var jobs = [];
  for (var i = 0; i < cards.length; i++) {
    var card = cards[i];
    var cardBody = card.querySelector(".recommend-job-card");
    if (!cardBody) continue;
    var href = card.getAttribute("href") || "";
    var m = href.match(/[?&]jobId=(\\d+)/);
    var id = m ? m[1] : "";
    var rows = Array.prototype.filter.call(cardBody.children, function (c) { return c.tagName === "DIV"; });
    var title = "";
    var salary = "";
    if (rows.length >= 1) {
      var kids = Array.prototype.filter.call(rows[0].children, function (c) { return c.tagName === "DIV"; });
      if (kids.length >= 1) title = String(kids[0].textContent || "").trim();
      if (kids.length >= 2) salary = String(kids[kids.length - 1].textContent || "").trim();
    }
    var company = "";
    if (rows.length >= 2) {
      var coSpan = rows[rows.length - 1].querySelector("span");
      if (coSpan) company = String(coSpan.textContent || "").trim();
    }
    if (!id || !title || !company) continue;
    var job = {};
    job.id = id;
    job.company = company;
    job.title = title;
    var tags = Array.prototype.map.call(cardBody.querySelectorAll(".tag-item"), function (t) { return String(t.textContent || "").trim(); }).filter(function (t) { return t !== ""; });
    var city = null;
    var degree = null;
    for (var k = 0; k < tags.length; k++) {
      if (/本科|专科|硕士|博士|不限/.test(tags[k])) {
        if (degree === null) degree = tags[k];
      } else if (city === null) {
        city = tags[k];
      }
    }
    if (city !== null) job.city = city;
    if (salary) job.salary = salary;
    if (degree !== null) job.degree = degree;
    job.url = "https://www.nowcoder.com/jobs/detail/" + id;
    jobs.push(job);
  }
  return JSON.stringify(jobs);
})()`;
/** 列表页 ego_js 执行后点击「秋招正式批」tab：返回 'ok' 或 'tab not found'。 */
const CLICK_ACTIVITY_TAB_EXPRESSION = `(() => {
  var tab = Array.from(document.querySelectorAll("ul.category-list li")).find(function (li) {
    return String(li.textContent || "").trim() === "27届秋招正式批";
  });
  if (!tab) return "tab not found";
  tab.click();
  return "ok";
})()`;
/**
* 列表页（已切「秋招正式批」tab）ego_js 执行后读取总览卡
* div.activity-info 内「查看详情」a.detail 的 href，去 query 规范化：
* 返回专场页 URL（如 https://www.nowcoder.com/jobs/activity/v2/special-activity/index/2027QZzc），
* 或 'detail link not found'。
*/
const GET_ACTIVITY_DETAIL_HREF_EXPRESSION = `(() => {
  var scope = document.querySelector(".activity-info") || document;
  var hit = Array.from(scope.querySelectorAll("a")).find(function (a) {
    return String(a.textContent || "").trim() === "查看详情"
      && String(a.getAttribute("href") || "").indexOf("special-activity") !== -1;
  });
  if (!hit) return "detail link not found";
  return String(hit.getAttribute("href") || "").split("?")[0];
})()`;
/** 专场页 ego_js 执行后点击「热招职位」区块：返回 'ok' 或 'hot tab not found'。 */
const CLICK_HOT_TAB_EXPRESSION = `(() => {
  var tab = Array.from(document.querySelectorAll("div.tab-bar span[data-tab]")).find(function (sp) {
    return String(sp.textContent || "").indexOf("热招职位") !== -1;
  });
  if (!tab) return "hot tab not found";
  tab.click();
  return "ok";
})()`;
/**
* 岗位详情页（/jobs/detail/<id>）JD 提取表达式（v0.1，ego_js 执行；
* v0.1.1 改：分节标题归一化 + 嵌入分节切分，修复 B1）。
*
* 真实 DOM（div.job-detail-infos 直系子，2026-07-20 实测三页；样本见
* test/fixtures/nowcoder-jd.html）：
*   - [岗位关键词 title div + <jobkeys> 元素]（可选）→ div.deliver-range →
*     岗位职责 title div + .ptb-2.pre-line 正文 → 岗位要求 title div +
*     .ptb-2.pre-line 正文 → [地址 div]（可选）。title div class 为
*     tw-text-size-head-pure fw-5（首节）或 mt-2 fw-5 tw-text-size-head-pure；
*     正文块内容按行（\n 分隔，可能整体带前导 \n）；
*   - 分节标题真实形态（2026-07-20 实测）：
*     ① 顶层 title div：文本恰为 岗位职责 / 岗位要求（或 加分项）；
*     ② 嵌入正文：加分项标题可出现在「岗位要求」正文 div 内的一行纯文本——
*        「**加分项：」（465607，** 粗体标记 + 全角冒号）或「加分项」（460855，
*        裸标题）。B1 真形：旧版严格相等匹配失配，加分项整段并入
*        requirements 输出；
*     ③ 正文内小标题行（458759）：岗位职责正文首行「岗位职责：」、岗位要求
*        正文首行「任职条件：」——普通内容，不是分节标题，不得切分；
*   - .deliver-range 内的 p 按前缀取：「毕业要求：」→ 毕业届（原样，可选）；
*     「投递时间：A-B」→ deadline 取 B（如
*     「2026年12月31日」）换算零填充 ISO（2026-12-31）；「工作地点：」等
*     其他前缀忽略；
*   - 「加分项」以顶层 div 缺席时页面留 <!----> 占位注释（非元素，children
*     自动跳过）。
*
* 分节匹配与赋值规则（v0.1.1 口径）：
*   标题归一化 norm(s) = 去全部 * 标记 → trim 首尾空白 → 去一个尾随全/半角
*   冒号（：/:）→ 与 岗位职责/岗位要求/加分项 严格相等。
*   两遍赋值：
*     pass 1（顶层，DOM 序）：scope 直系子元素 norm 文本命中分节名 →
*       nextElementSibling 正文块按 /\n+/ 切行、trim、去空；先到先占（同名
*       后者忽略）；
*     pass 2（嵌入，按 description/requirements/bonus 固定序）：某节正文行中
*       首个 norm 命中「异名且尚未被占」分节的行 → 以该行为界切分：其前行
*       留在本节，其后行成为该节正文（级联：被切出的节在后续轮次继续参与
*       pass 2）。与本节同名的标题行（如 岗位职责 正文里的「岗位职责：」）
*       当普通内容，不切分。
*
* 字段映射规则（v0.1 口径，正文块取行方式不变）：
*   description    = 「岗位职责」正文行
*   requirements   = 「岗位要求」正文行（不含被切出的加分项段——B1 回归点）
*   bonus          = 「加分项」正文行（顶层 div 或嵌入切分两路任一；缺席时
*                    省略键）
*   deadline       = 投递时间 B 端的零填充 ISO（YYYY-MM-DD；无则省略）
*   graduationYear = 毕业要求前缀后的原文（无则省略；
*                    工具侧按「有则覆盖、无则保留」写入 Job.graduationYear，v0.1 字段扩展修正）
*   输出为 JSON 字符串，键序固定 description, requirements, bonus?,
*   deadline?, graduationYear?（缺失/空节键省略）。
*   div.job-detail-infos 不存在 → 返回 {"error":"job-detail-infos not found"}
*   （skill 指示立即停止并告知用户）。
*/
const EXTRACT_JD_EXPRESSION = `(() => {
  var scope = document.querySelector("div.job-detail-infos");
  if (!scope) return JSON.stringify({ "error": "job-detail-infos not found" });
  var NAME2KEY = { "岗位职责": "description", "岗位要求": "requirements", "加分项": "bonus" };
  // v0.1.1：标题归一化——去 * 标记、trim、去一个尾随全/半角冒号。
  function norm(s) {
    var t = String(s || "").replace(/\\*/g, "").trim();
    if (t.charAt(t.length - 1) === "：" || t.charAt(t.length - 1) === ":") t = t.slice(0, -1);
    return t;
  }
  function bodyLines(el) {
    return String(el.textContent || "").split(/\\n+/).map(function (s) { return s.trim(); }).filter(function (s) { return s !== ""; });
  }
  var assigned = {};
  // pass 1：顶层「title div + nextElementSibling 正文」（DOM 序，先到先占）。
  var kids = scope.children;
  for (var i = 0; i < kids.length; i++) {
    var el = kids[i];
    var key = NAME2KEY[norm(el.textContent)];
    if (!key) continue;
    var body = el.nextElementSibling;
    if (!body || assigned[key]) continue;
    var lines = bodyLines(body);
    if (lines.length > 0) assigned[key] = lines;
  }
  // pass 2：嵌入分节——节正文行中首个「异名且未占」的标题行切分（B1：
  // 「**加分项：」/「加分项」嵌在岗位要求正文内）；同名行当普通内容不切分。
  var ORDER = ["description", "requirements", "bonus"];
  for (var s = 0; s < ORDER.length; s++) {
    var sk = ORDER[s];
    var sl = assigned[sk];
    if (!sl) continue;
    var cut = -1;
    var cutKey = "";
    for (var j = 0; j < sl.length; j++) {
      var ek = NAME2KEY[norm(sl[j])];
      if (ek && ek !== sk && !assigned[ek]) { cut = j; cutKey = ek; break; }
    }
    if (cut !== -1) {
      assigned[sk] = sl.slice(0, cut);
      assigned[cutKey] = sl.slice(cut + 1);
    }
  }
  var out = {};
  if (assigned.description && assigned.description.length > 0) out.description = assigned.description;
  if (assigned.requirements && assigned.requirements.length > 0) out.requirements = assigned.requirements;
  if (assigned.bonus && assigned.bonus.length > 0) out.bonus = assigned.bonus;
  // deliver-range 的 p 按前缀取毕业要求/投递时间（DOM 里两个 p 的先后不定，
  // 先收集后按固定键序插入：deadline 在 graduationYear 之前）。
  var gradYear = null;
  var deadlineIso = null;
  var range = scope.querySelector(".deliver-range");
  if (range) {
    var ps = range.querySelectorAll("p");
    for (var j = 0; j < ps.length; j++) {
      var t = String(ps[j].textContent || "").trim();
      var mGrad = t.match(/^毕业要求：(.*)$/);
      if (mGrad) {
        var g = mGrad[1].trim();
        if (g !== "") gradYear = g;
        continue;
      }
      var mDel = t.match(/^投递时间：(.*)$/);
      if (mDel) {
        var rangeText = mDel[1].trim();
        var dash = rangeText.indexOf("-");
        if (dash !== -1) {
          var b = rangeText.slice(dash + 1).trim();
          var dm = b.match(/(\\d{4})年(\\d{1,2})月(\\d{1,2})日/);
          if (dm) {
            var mo = dm[2].length === 1 ? "0" + dm[2] : dm[2];
            var dd = dm[3].length === 1 ? "0" + dm[3] : dm[3];
            deadlineIso = dm[1] + "-" + mo + "-" + dd;
          }
        }
      }
    }
  }
  if (deadlineIso !== null) out.deadline = deadlineIso;
  if (gradYear !== null) out.graduationYear = gradYear;
  return JSON.stringify(out);
})()`;
/**
* 校招日程页（/jobs/school/schedule）提取表达式（v0.1，ego_js 执行）。
*
* 真实 DOM（侦察样本见 test/fixtures/nowcoder-schedule.html；v0.1 现场
* 核对全部 20 张公司卡的 title class）：页面约 31 个 div.list-item，仅 20 个
* 含 .company-content 公司卡，其余是空骨架（div.list-item 只含文本节点，
* 加载中/无数据占位）——**只处理含 .company-content 的卡**。公司卡结构
* （20 张全量核验）：div.list-item.tw-cursor-pointer > a.tw-block.clearfix，
* 直系子为收藏按钮 span.follow-btn、div.act-company-head（内含标题容器
* div.company）、div.company-short-introduce（简介）、div.company-content、
* 投递按钮 div。
*   - div.company 直系子固定为 img.logo + div.logo-mark + 标题 div；每卡
*     **只有一个** div.title → 标题用直系选择器 div.company > div.title 取
*   - title class 两种真实变体（v0.1 现场核对）：
*       单行公司名卡 = 「title tw-text-2xl-pure」（18 张）
*       公司名跨两行卡 = 「title」（无 tw-text-2xl-pure）（2 张：平安产险
*       科技中心、深圳虾皮信息科技有限公司）
*     旧选择器 div.title.tw-text-2xl-pure 在真实页面只能取到 20 张中的
*     18 张，故放宽为 div.company > div.title
*   - company = 标题 div 的 trim 文本；跨两行机制是标题含两个块级子
*     div.line（如 <div class="line">深圳虾皮信息</div>
*     <div class="line">科技有限公司</div>），textContent 无换行字符，公司名
*     天然连续；split(/\\n+/) 分行合并逻辑保留（防御文本确实含换行的
*     情形：按行 trim、去空、连接为一个字符串）
*   - .company-content 内所有 span 的 trim 文本序列（去空串；span 嵌套两层：
*     div.tw-w-[186px] 容器内两行 div.tw-flex，上行 = 批次 | 分隔 | 收录，
*     下行 = 「地点：」+ 城市（城市 span 带 el-tooltip city-hidden item 类）），
*     实测变体（第一个 span 为站点届次标签原文，形态多样、可能含内部空格，
*     以 <届次标签> 占位）：
*       ["<届次标签>", "丨", "08.16收录", "地点：", "杭州、广州、深圳、北京、上海"]
*       ["网申中", "丨", "09.04收录", "地点：", "南京"]
*       ["<届次标签>", "丨", "04.03收录", "地点：", "…"]
*       ["网申：", "正在收集中", "地点：", "正在收集中"]（无收录日期）
*
* 字段映射规则（v0.1 口径）：
*   company      = 合并后的公司名（无公司名的卡跳过）
*   batch        = 第一个 span 原文（缺省省略；工具侧无 batch 时记「未知」）
*   recordedDate = 匹配 /^(\\d{2})\\.(\\d{2})收录$/ 的 span 去掉「收录」后的
*                  MM.dd 原文（无则省略）
*   cities       = 「地点：」之后的下一个 span；其值为「正在收集中」时省略
*   输出为 JSON 字符串数组，元素键序 company, batch?, recordedDate?,
*   cities?（缺失键省略）。
*/
const EXTRACT_SCHEDULE_EXPRESSION = `(() => {
  var cards = Array.from(document.querySelectorAll("div.list-item"));
  var items = [];
  for (var i = 0; i < cards.length; i++) {
    var card = cards[i];
    var content = card.querySelector(".company-content");
    if (!content) continue;
    var titleEl = card.querySelector("div.company > div.title");
    if (!titleEl) continue;
    var lines = String(titleEl.textContent || "").split(/\\n+/).map(function (s) { return s.trim(); }).filter(function (s) { return s !== ""; });
    var company = lines.join("");
    if (company === "") continue;
    var spans = Array.prototype.map.call(content.querySelectorAll("span"), function (s) { return String(s.textContent || "").trim(); }).filter(function (s) { return s !== ""; });
    var item = {};
    item.company = company;
    if (spans.length >= 1) item.batch = spans[0];
    var rec = null;
    for (var k = 0; k < spans.length; k++) {
      var m = spans[k].match(/^(\\d{2})\\.(\\d{2})收录$/);
      if (m) { rec = m[1] + "." + m[2]; break; }
    }
    if (rec !== null) item.recordedDate = rec;
    for (var c = 0; c < spans.length; c++) {
      if (spans[c] === "地点：" && c + 1 < spans.length) {
        var cities = spans[c + 1];
        if (cities !== "正在收集中") item.cities = cities;
        break;
      }
    }
    items.push(item);
  }
  return JSON.stringify(items);
})()`;
//#endregion
//#region src/skill/campus-hunt.skill.ts
/**
* dsh-campus-hunt — campus-hunt skill 定义（v0.1）。
* v0.1 追加两节工作流：JD 详情（campus_job_detail 入库）与校招日程
* （campus_schedule 入库），对应新增「表达式 5 / 表达式 6」。
* v0.1 改工厂 buildCampusHuntSkill(cfg)：红线两行（导航间隔 / 单轮上限）
* 按当前配置参数化；默认配置下 content 与 v0.1 注册值字节一致。
* v0.1.1 新增「GUI 动作回调协议」一节：回答区卡片 3 个按钮的动作提示词
* 使用本插件自有 [campus-hunt-action] 前缀，由 skill 自教 agent 协议语义，
* 自然语言指令句保留为兜底。
* v0.1.1：专场页 URL 可配置（cfg.specialUrl，默认 2027QZzc）；默认
* 配置下 content 与 v0.1.1 字节一致。
* v0.1.1：新增「个性化推荐」节（用户要推荐/挑选时按画像语义过滤
* 排序，不重新采集）；whenToUse 注册字段与 content「何时使用」节各补一行
* 推荐意图（纯推荐措辞的路由修复落在注册字段——模型实际看到的路由面）。
* v0.1.1（画像直供）：推荐节的画像来源从「读 workspace 副本」改为
* 「campus_job_search 返回的画像行」（画像只存 settings、无 workspace 副本）；
* 当前会话没有该返回时先调 campus_job_search(raw=[]) 一次（查询调用，
* 零副作用）。
*
* 给模型的牛客校招岗位采集工作流（2026-09-04 实测修订版）：
*   主路线：ego_navigate 列表页 → 点「秋招正式批」tab → 读总览卡
*   「查看详情」href（去 query 规范化）→ ego_navigate 专场页 → 关登录弹窗
*   （Escape）→ 点「热招职位」区块 → ego_js 提取表达式 →
*   campus_job_search 入库。
*   备用路线：主路线任一步失败时直接 ego_navigate 专场 URL
*   https://www.nowcoder.com/jobs/activity/v2/special-activity/index/2027QZzc
*   （2026-09-04 实测匿名可访问；列表页总览卡「查看详情」href 实测指向该
*   页——「列表页→查看详情」能自动发现专场 URL，更抗改版，故列为主路线）。
*
* 背景：列表页「全部职位」tab 的 line-one 卡片混届（Job schema 无届字段
* 无法区分）；匿名态「秋招正式批」tab 只有企业总览墙 + 登录弹窗，
* 无岗位列表。真实列表在专场页「热招职位」区块（40 张卡第一屏，
* 无分页）。
*
* 六个表达式从 src/nowcoder/extract.ts 原样嵌入 content（代码块），
* 保证 skill 指令与测试求值的字符串是同一份（单一事实源）。
*
* content 用行数组 join 构造（而非模板字符串）：markdown 代码围栏需要
* 裸反引号，行数组避免转义。
*/
const FENCE = "```";
/**
* 构造 skill 正文。
* @param intervalSec - 导航间隔秒数（collection.minIntervalMs / 1000；红线行）。
* @param maxItems - 单轮采集上限条数（collection.maxItemsPerRun；红线行）。
* @param specialUrl - 专场页 URL（cfg.specialUrl；备用路线直开入口）。
*/
function buildContent(intervalSec, maxItems, specialUrl) {
	return [
		"# campus-hunt — 牛客校招岗位采集",
		"",
		"## 何时使用",
		"用户要查看/采集牛客（nowcoder.com）校招岗位（尤其「秋招正式批」专场），",
		"如\"看看牛客秋招有什么岗位\"、\"采集校招职位\"、\"把牛客校招岗位入库\"。",
		"用户要推荐/挑选适合自己的校招岗位（如\"帮我推荐岗位\"、\"哪些岗位适合我\"）时",
		"同样适用——走下文「个性化推荐」节（不重新采集）。",
		"",
		"## GUI 动作回调协议（回答区岗位卡片按钮）",
		"收到以 `[campus-hunt-action]` 开头的提示词 = 回答区岗位卡片（岗位列表 / 详情 / 投递追踪",
		"三 tab）的动作回调，不是用户手打消息。格式 `[campus-hunt-action] <action> <JSON>`，",
		"其后一行是自然语言指令句；按 JSON payload 与指令句执行，回复简短：",
		"- `campus_hunt.track_status` → 用 job_track 更新 payload 中岗位的状态",
		"  （payload：jobId/company/title/status）。",
		"- `campus_hunt.track_add` → 用 job_track 以「未处理」状态新增 payload 中的岗位",
		"  （payload：jobId/company/title）。",
		"- `campus_hunt.recollect_jd` → 对 payload 中的 jobId 执行下文「JD 详情」工作流，",
		"  经 campus_job_detail 入库（payload：jobId，可能含 url）。",
		"前缀后的指令句是同一动作的兜底描述，与上述处置一致时直接按其执行。",
		"",
		"## 工作流（按顺序执行；页面导航之间间隔 ≥1 秒）",
		"0. 打开任务空间：ego_space_open(\"nowcoder\")——隔离浏览上下文（继承登录态），",
		"   本次采集流程的全部 ego_* 调用都在该空间执行（无需逐次传 space 参数）。",
		"   采集完成后必须用 ego_space_close(\"nowcoder\") 关闭（见第 24 步后收尾说明）。",
		"### 主路线：列表页 →「秋招正式批」总览卡 →「查看详情」→ 专场页",
		"1. 打开列表页：ego_navigate 访问 https://www.nowcoder.com/jobs/school/jobs",
		"2. 等 tab 栏渲染：ego_wait_for_selector 等待 selector \"ul.category-list li\"",
		"   （tab 列表动态加载，「秋招正式批」可能稍后才出现）。",
		"3. 点「秋招正式批」tab：ego_js 执行「表达式 1」。",
		"   - 返回 'ok' → 继续下一步",
		"   - 返回 'tab not found' → ego_wait 约 1500ms 后重试一次；仍 'tab not found'",
		"     → 改用备用路线（第 8 步）",
		"4. 等总览卡渲染：ego_wait_for_selector 等待 selector \".activity-info\"。",
		"   （该 tab 下是「企业：N家 在招职位：N个」总览卡 + 企业墙，**没有岗位列表**。）",
		"5. 读「查看详情」链接：ego_js 执行「表达式 2」，返回去 query 规范化的",
		`   专场页 URL（形如 ${specialUrl}）。`,
		"   - 返回 URL → 间隔 ≥1 秒后 ego_navigate 该 URL",
		"   - 返回 'detail link not found' → 改用备用路线（第 8 步）",
		"### 备用路线（主路线任一步失败时）",
		`8. 直接 ego_navigate 专场页：${specialUrl}`,
		"   （2026-09-04 实测匿名可访问；「查看详情」href 实测即指向此页。）",
		"### 专场页提取（主/备用路线汇合后）",
		"9. 若出现登录弹窗（.v-modal / .login-dialog 遮罩）：ego_key 按 Escape 关闭并",
		"   记录该事实；不登录、不填写任何账号信息（见红线）。",
		"   随后用 ego_captcha 检测人机验证（reCAPTCHA / hCaptcha / Cloudflare /",
		"   Turnstile）：detected=true → 提示用户在「ego lite - agent」观察窗完成验证，",
		"   确认完成后继续；不代解、不绕验证（见红线）。",
		"10. 等 tab 栏渲染：ego_wait_for_selector 等待 selector \"div.tab-bar\"。",
		"11. 点「热招职位」区块：ego_js 执行「表达式 3」——页面默认停在",
		"    「热招企业」tab（企业墙，无岗位列表），必须切换。",
		"    - 返回 'ok' → 继续下一步",
		"    - 返回 'hot tab not found' → 立即停止并告知用户（页面结构可能已变化）",
		"12. 等岗位卡片渲染：ego_wait_for_selector 等待 selector \"a.job-item\"，再 ego_wait",
		"    约 1000ms。第一屏约 40 张卡，**无分页、无「加载更多」，只采第一屏**。",
		"13. 提取岗位：ego_js 执行「表达式 4」，返回值是 JSON 字符串",
		"    （岗位对象数组，字段 id/company/title/city/salary/degree/url，缺失省略）。",
		"14. 入库：把第 13 步返回的 JSON 数组作为 raw 调用 campus_job_search",
		"    （JSON 字符串原样传或解析成数组传均可）；用户指定了城市或关键词时",
		"    同时传 filter（query 匹配公司/岗位名，city 匹配城市字段，两者同时给为 AND）。",
		"### JD 详情（用户指定岗位后执行；一次只采 1 条）",
		"15. 选岗：从 jobs.json（或上一步 campus_job_search 返回的 jobs）里选出用户",
		"    指定的 1 个岗位，取其 id 与 url（形如 https://www.nowcoder.com/jobs/detail/<id>）。",
		"    若用户没指定岗位：先展示岗位列表让用户选，不擅自批量循环采 JD。",
		"16. 打开详情页：间隔 ≥1 秒后 ego_navigate 该 url。",
		"17. 等详情渲染：ego_wait_for_selector 等待 selector \".job-detail-infos\"（timeout 30s）。",
		"    若出现登录弹窗（.v-modal / .login-dialog）：ego_key 按 Escape 关闭并",
		"    记录该事实；不登录、不填写任何账号信息。",
		"    随后用 ego_captcha 检测人机验证：detected=true → 提示用户在「ego lite -",
		"    agent」观察窗完成验证，确认完成后继续；不代解、不绕验证（见红线）。",
		"18. 提取 JD：ego_js 执行「表达式 5」，返回值是 JSON 字符串",
		"    （description[]/requirements[]，缺失键省略：bonus?/deadline?/graduationYear?）。",
		"19. 解析返回值：若含 error 键（如 \"job-detail-infos not found\"）→ 立即停止",
		"    并告知用户（页面结构可能已变化），不重试。",
		"20. 入库：campus_job_detail（raw = 第 18 步 JSON 原样传或解析成对象传均可，",
		"    jobId = 岗位 id）。工具会写入 job.jd、覆盖 deadline（若 raw 带 ISO 截止日）、",
		"    覆盖 graduationYear（若 raw 带毕业要求原文；raw 未带则保留",
		"    既有值）、刷新 fetchedAt。一次只采 1 条 JD。",
		"### 校招日程（用户要日程时执行）",
		"21. 打开日程页：间隔 ≥1 秒后 ego_navigate https://www.nowcoder.com/jobs/school/schedule",
		"22. 等卡片渲染：ego_wait_for_selector 等待 selector \"div.list-item\"（timeout 30s）。",
		"    若出现登录弹窗（.v-modal / .login-dialog）：ego_key 按 Escape 关闭并",
		"    记录该事实；不登录、不填写任何账号信息。",
		"    随后用 ego_captcha 检测人机验证：detected=true → 提示用户在「ego lite -",
		"    agent」观察窗完成验证，确认完成后继续；不代解、不绕验证（见红线）。",
		"23. 提取日程：ego_js 执行「表达式 6」，返回值是 JSON 字符串（公司卡数组：",
		"    company/batch?/recordedDate?/cities?，缺失省略；空骨架卡已在表达式内跳过）。",
		"    **只采第一屏，不翻页、不点「加载更多」、不滚动触发加载。**",
		"24. 入库：campus_schedule（raw = 第 23 步 JSON 原样传或解析成数组传均可）。",
		"    工具按 company 去重合并进 schedule.json，返回合并后全量。",
		"收尾（本次采集流程结束后）：ego_space_close(\"nowcoder\") 关闭任务空间——",
		"close 必须是本次任务的最后一个 ego_* 调用。",
		"### 个性化推荐（用户要「推荐/挑几个/哪些适合我」时执行；不重新采集）",
		"25. 数据源：会话 workspace 的 jobs.json（或本次入库返回的全量 jobs）。",
		"    **推荐不重新采集**：jobs.json 不存在或为空时，先走上文采集工作流入库，",
		"    再执行本节。",
		"26. 读画像：用 campus_job_search 返回的画像行（该工具返回恒带当前画像：",
		"    「当前画像：方向 a/b · 城市 c · 目标公司 d」；「画像未设置（要个性化",
		"    推荐请在设置页填写）」= 未设置）。当前会话没有该返回（还没做过采集 /",
		"    查询）→ 先调 campus_job_search(raw=[]) 一次（取全量 jobs + 当前画像的",
		"    查询调用，零副作用），再执行本节。",
		"    - 画像行为「画像未设置」→ 不过滤：展示全量岗位（公司/名称/城市/",
		"      薪资），并提示用户「可在设置页填写求职画像（方向/城市/目标公司）后获得",
		"      个性化推荐」。",
		"    - 存在画像 → 按 directions/cities/targetCompanies 对全量 jobs 做语义过滤",
		"      与排序（目标公司命中优先、方向匹配岗位名/公司名次之、城市再次；拿不准的",
		"      宁缺毋滥），输出推荐短名单（3–8 条）+ 每条的匹配理由（命中哪个 tag、",
		"      为何合适）。",
		"    - 无岗位命中画像 → 明说「画像内暂无匹配岗位」，附 2–3 条最接近的岗位",
		"      并说明差距。",
		"27. 推荐结果以文字回复（每条含公司/岗位名/城市/薪资与理由）；用户点名某岗位后，",
		"    按需走「JD 详情」工作流或 GUI 卡片按钮动作，不擅自批量采 JD。",
		"",
		"## 红线（不可违反）",
		"- 只读采集：不登录、不注册、不绕过验证码、不向用户索要任何账号/密码/凭证。",
		"- 专场页/列表页/详情页/日程页出现登录弹窗（.v-modal / .login-dialog）：只按 Escape 关闭并记录。",
		"- 出现登录墙或验证码**阻断内容**时：立即停止，把现状告知用户，不重试、不尝试绕过。",
		"- 人机验证（反爬）：页面被 reCAPTCHA / hCaptcha / Cloudflare / Turnstile 等人机验证组件",
		"  拦截时，用 ego_captcha 检测（或 ego_page_info 的 humanCheck 字段）：detected=true →",
		"  提示用户在「ego lite - agent」观察窗完成验证，确认完成后继续；不代解、不绕验证、不重试。",
		"- 只采第一屏/首页（约 40 张卡；日程页同样只采第一屏）：不翻页、不点「加载更多」、不滚动触发加载。",
		`- 页面导航之间间隔 ≥${intervalSec} 秒。`,
		`- 单轮采集 ≤${maxItems} 条：返回数组超过 ${maxItems} 条时只入库前 ${maxItems} 条，并告知用户。`,
		"- JD 详情一次只采 1 条（用户指定哪条），不批量循环。",
		"",
		"## 表达式 1：列表页点「秋招正式批」tab（ego_js）",
		"```js",
		CLICK_ACTIVITY_TAB_EXPRESSION,
		FENCE,
		"",
		"## 表达式 2：列表页总览卡读「查看详情」专场页 URL（ego_js）",
		"```js",
		GET_ACTIVITY_DETAIL_HREF_EXPRESSION,
		FENCE,
		"",
		"## 表达式 3：专场页点「热招职位」区块（ego_js）",
		"```js",
		CLICK_HOT_TAB_EXPRESSION,
		FENCE,
		"",
		"## 表达式 4：提取专场页「热招职位」列表岗位（ego_js）",
		"```js",
		EXTRACT_LIST_EXPRESSION,
		FENCE,
		"",
		"## 表达式 5：提取岗位详情页 JD（ego_js）",
		"```js",
		EXTRACT_JD_EXPRESSION,
		FENCE,
		"",
		"## 表达式 6：提取校招日程页公司卡（ego_js）",
		"```js",
		EXTRACT_SCHEDULE_EXPRESSION,
		FENCE
	].join("\n");
}
/**
* 按当前配置构造 campus-hunt skill 注册值（v0.1）：红线两行（导航间隔 /
* 单轮上限）随 collection.minIntervalMs / maxItemsPerRun 变化，其余正文与
* 路由字段不变。
* @param cfg - 当前配置（currentConfig()）。
*/
function buildCampusHuntSkill(cfg) {
	return {
		name: "campus-hunt",
		description: "牛客（nowcoder.com）校招岗位只读采集工作流：经 ego 浏览器打开列表页、切「秋招正式批」tab、经总览卡「查看详情」进入专场页、点「热招职位」区块执行提取表达式、再经 campus_job_search 把岗位入库到会话 workspace 的 jobs.json；另含 JD 详情（ego_navigate 岗位详情页执行提取表达式，经 campus_job_detail 写入 job.jd，一次 1 条）与校招日程（ego_navigate 日程页执行提取表达式，经 campus_schedule 入库 schedule.json）。",
		whenToUse: "用户提到牛客/nowcoder 校招岗位、秋招（正式批）职位列表、要把校招岗位采集入库、要看某个岗位的 JD 详情、要看牛客校招日程（哪些公司何时开放网申）、或要推荐/挑选适合自己的校招岗位（如\"帮我推荐岗位\"、\"哪些岗位适合我\"）时。",
		source: "runtime",
		content: buildContent(cfg.collection.minIntervalMs / 1e3, cfg.collection.maxItemsPerRun, cfg.specialUrl)
	};
}
buildCampusHuntSkill(defaultConfig);
//#endregion
//#region src/version.ts
/**
* dsh-campus-hunt — 插件版本号单一来源。
*
* 直接 import 包根 package.json 的 version 字段：tsdown 构建时内联为字面量
* （宿主经 tsx 从源码直接 import 时同样解析到包根）。bump package.json
* 版本后重建即同步——日志等运行时输出与包版本永不漂移，无需另维护常量。
*/
/** 当前插件版本（package.json 的 version 原文，如 "0.1.1"）。 */
const PLUGIN_VERSION = "0.1.1";
//#endregion
//#region src/index.ts
/**
* dsh-campus-hunt — DSH 校招求职 Client 插件（host 半场）。
*
* v0.1：注册 job_track（本地投递流水线，纯 JSON 无网络）。
* v0.1：注册 campus_job_search（校招岗位入库，raw 由 campus-hunt skill
* 的浏览器采集工作流提供，工具本身不碰网络）与 campus-hunt skill（注入
* tools + skills 两个服务）。
* v0.1：注册 campus_job_detail（岗位 JD 详情入库，写 job.jd / 覆盖
* deadline / 刷新 fetchedAt）与 campus_schedule（校招日程入库，company
* 去重合并进 schedule.json）；campus-hunt skill 追加 JD 详情与校招日程
* 两节工作流（表达式 5/6）。
* v0.1：4 个工具 presentationMeta 从"规范值本身"升级为卡片投影
* （{ card: 'jobs'|'job'|'schedule'|'tracks', tool, 数据字段 }），
* client 半场（src/client/）以会话节点 campus-cards 在回答区注册三 tab
* 卡片（v0.1.1）。
* v0.1：settings 半场——Config（schemastery）双重身份（cordis entry
* `config:` 校验 + settings namespace `campus-hunt` 模式）；apply 接收 entry
* 配置、经 ctx.inject(['settings']) 瀑布 installSection（provider 缺席时
* 跳过）；3 个采集工具（search/detail/schedule）消费采集红线（截断 /
* 域名白名单，job_track 不消费采集配置）；skill 改工厂，红线两行随配置
* 参数化，onChange best-effort 重注册（同 id runtime skill first-wins：先
* dispose 再注册）。
* v0.1.1（画像直供）：profile.json 物化（syncProfile）废弃——求职画像
* 只存 settings 的 campus-hunt 分节、无 workspace 副本；free-search 模式
* （host 侧每次 execute 活读 currentConfig()）下由 campus_job_search 返回行
* 直供模型。
* 数据层 local-first（workspace 下 3 个数据文件：jobs.json / track.json /
* schedule.json，schema v0）。
*/
const name = "dsh-campus-hunt";
const inject = ["tools", "skills"];
function apply(ctx, config) {
	setSource(() => config);
	ctx.tools.register(jobTrackTool);
	ctx.tools.register(campusJobSearchTool);
	ctx.tools.register(campusJobDetailTool);
	ctx.tools.register(campusScheduleTool);
	const initialSkill = buildCampusHuntSkill(currentConfig());
	let skillContent = initialSkill.content;
	let disposeSkill = ctx.skills.register(initialSkill);
	ctx.inject(["settings"], (settingsCtx) => {
		settingsCtx.settings.installSection(ctx, NS, Config, config, {
			setSource,
			onChange: () => {
				const next = buildCampusHuntSkill(currentConfig());
				if (next.content !== skillContent) {
					disposeSkill();
					skillContent = next.content;
					disposeSkill = ctx.skills.register(next);
				}
			}
		});
	});
	console.log(`[dsh-campus-hunt] job_track + campus_job_search + campus_job_detail + campus_schedule + campus-hunt skill registered (v${PLUGIN_VERSION})`);
}
//#endregion
export { Config, NS, PLUGIN_VERSION, apply, currentConfig, defaultConfig, inject, isDomainAllowed, name, setSource };

//# sourceMappingURL=index.js.map