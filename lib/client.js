window.__ModuleLoader__.load({
	id: "dsh-campus-hunt",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		let react_jsx_runtime = require("react/jsx-runtime");
		//#region src/client/campus-cards.ts
		/** 产卡片的 4 个 campus 工具（host 工具 wire 名）。 */
		const CAMPUS_CARD_TOOLS = /* @__PURE__ */ new Set([
			"campus_job_search",
			"campus_job_detail",
			"campus_schedule",
			"job_track"
		]);
		function asRecord$1(v) {
			return v !== null && typeof v === "object" && !Array.isArray(v) ? v : null;
		}
		/** 有限非负整数（与 host common.ts coordinate 同口径）。 */
		function safeInt(v) {
			return typeof v === "number" && Number.isSafeInteger(v) && v >= 0 ? v : void 0;
		}
		/** 事件 data.turn（match / update 的唯一 scope 维度）。 */
		function eventTurn(event) {
			return safeInt(asRecord$1(event.data)?.turn);
		}
		/**
		* 从 turn 位置读 PTC 卫星卡片（v0.1.3 聚合读取路径）：buildLocationData
		* 只在 endSeq 已定义时发布 → 末 match 必为 turn/end → 其 location（kind
		* 'turn'）的 steps 为当前全量；按 step 序 data.get('campus-cards-ptc') →
		* { cards }；缺席 / 畸形（非对象、cards 非数组）按无处理。
		*/
		function ptcCardsFromTurnLocation(location) {
			if (location.kind !== "turn" || location.turn === void 0) return [];
			const out = [];
			for (const step of location.turn.steps) {
				const value = asRecord$1(step.data.get("campus-cards-ptc"));
				if (value === null) continue;
				if (Array.isArray(value.cards)) out.push(...value.cards);
			}
			return out;
		}
		/** 卫星 pack 卡片 → JobCards entry（v0.1.3）：content ?? [] 归一；argsRaw 透传（fold 已 '' 兜底）。 */
		function ptcBlockToEntry(block) {
			return {
				callId: block.callId,
				tool: block.call.name,
				block: {
					kind: "tool-result",
					callId: block.callId,
					call: {
						name: block.call.name,
						argsRaw: block.call.argsRaw
					},
					content: block.content ?? [],
					isError: false
				}
			};
		}
		/**
		* cards = native state.cards ∪ PTC 卫星 step location 卡片（v0.1.3）：并序
		* = native 在前 + PTC 按 step 序；按 callId 去重（'both' 模式两 id 域天然
		* 不相交，去重是防御）；无 PTC 卡片 → 引用返回 state.cards（native 回合
		* 字节不变）。
		*/
		function aggregateTurnCards(state, matches) {
			const last = matches[matches.length - 1];
			if (last === void 0) return state.cards;
			const ptc = ptcCardsFromTurnLocation(last.location);
			if (ptc.length === 0) return state.cards;
			const out = [...state.cards];
			const seen = new Set(state.cards.map((card) => card.callId));
			for (const block of ptc) {
				if (block.callId === "" || seen.has(block.callId)) continue;
				seen.add(block.callId);
				out.push(ptcBlockToEntry(block));
			}
			return out;
		}
		const campusCardsDefinition = {
			kind: "campus-cards",
			match: (event) => {
				const turn = eventTurn(event);
				if (turn === void 0) return null;
				if (event.type === "turn/start") return {
					id: String(turn),
					role: "start"
				};
				if (event.type === "tool/call") return {
					id: String(turn),
					role: "update"
				};
				if (event.type === "tool/result") return event.surfaceOp === "append" ? {
					id: String(turn),
					role: "update"
				} : null;
				if (event.type === "turn/end") return {
					id: String(turn),
					role: "update"
				};
				return null;
			},
			start: (_context, match) => {
				if (match.event.type !== "turn/start") throw new Error("campus-cards start requires turn/start");
				const turn = eventTurn(match.event);
				if (turn === void 0) throw new Error("campus-cards start: malformed turn");
				return {
					turn,
					calls: /* @__PURE__ */ new Map(),
					cards: [],
					endSeq: void 0
				};
			},
			update: (context, match) => {
				const event = match.event;
				const state = context.state;
				const turn = eventTurn(event);
				if (turn === void 0 || turn !== state.turn) return state;
				if (event.type === "tool/call") {
					const d = asRecord$1(event.data);
					if (d === null) return state;
					const name = typeof d.name === "string" ? d.name : "";
					const callId = typeof d.callId === "string" && d.callId !== "" ? d.callId : "";
					if (name === "" || callId === "" || !CAMPUS_CARD_TOOLS.has(name)) return state;
					const calls = new Map(state.calls);
					calls.set(callId, {
						tool: name,
						argsRaw: typeof d.arguments === "string" ? d.arguments : ""
					});
					return {
						...state,
						calls
					};
				}
				if (event.type === "tool/result") {
					const d = asRecord$1(event.data);
					const message = d === null ? null : asRecord$1(d.message);
					const source = message === null ? null : asRecord$1(message.source);
					const callId = source !== null && typeof source.callId === "string" ? source.callId : "";
					const call = callId === "" ? void 0 : state.calls.get(callId);
					if (call === void 0) return state;
					const result = asRecord$1((message !== null && Array.isArray(message.content) ? message.content : [])[0]);
					if (result !== null && result.isError === true) return state;
					const content = result !== null && Array.isArray(result.content) ? result.content : [];
					const block = {
						kind: "tool-result",
						callId,
						call: {
							name: call.tool,
							argsRaw: call.argsRaw
						},
						content,
						isError: false
					};
					if (d !== null && d.meta !== void 0) block.meta = d.meta;
					if (d !== null && d.error !== void 0) block.error = d.error;
					return {
						...state,
						cards: [...state.cards, {
							callId,
							tool: call.tool,
							block
						}]
					};
				}
				if (event.type === "turn/end") return {
					...state,
					endSeq: event.seq
				};
				return state;
			},
			publication: (match) => match.event.type === "turn/end" ? "immediate" : "none",
			buildLocationData: (context, scope, previous) => {
				if (scope !== "turn") return null;
				const state = context.state;
				if (state === void 0 || state.endSeq === void 0) return null;
				const cards = aggregateTurnCards(state, context.matches);
				if (cards.length === 0) return null;
				if (previous !== null && previous.kind === "turn" && previous.key === "campus-cards") {
					const value = asRecord$1(previous.value);
					if (value !== null && value.cards === cards) return previous;
				}
				return {
					kind: "turn",
					turn: state.turn,
					key: "campus-cards",
					value: { cards }
				};
			}
		};
		const campusCardsPtcDefinition = {
			kind: "campus-cards-ptc",
			match: (event) => {
				if (event.type === "tool/call") {
					const d = asRecord$1(event.data);
					if (d === null) return null;
					if (typeof d.name !== "string" || d.name !== "run_code") return null;
					const callId = typeof d.callId === "string" && d.callId !== "" ? d.callId : "";
					if (callId === "") return null;
					return {
						id: callId,
						role: "start"
					};
				}
				if (event.type === "tool/ptc-dispatch") {
					const d = asRecord$1(event.data);
					if (d === null) return null;
					const name = typeof d.name === "string" ? d.name : "";
					if (!CAMPUS_CARD_TOOLS.has(name)) return null;
					const rootCallId = typeof d.rootCallId === "string" && d.rootCallId !== "" ? d.rootCallId : "";
					if (rootCallId === "") return null;
					return {
						id: rootCallId,
						role: "update"
					};
				}
				return null;
			},
			start: (_context, match) => {
				if (match.event.type !== "tool/call") throw new Error("campus-cards-ptc start requires tool/call");
				const d = asRecord$1(match.event.data);
				return {
					turn: d === null ? void 0 : safeInt(d.turn),
					step: d === null ? void 0 : safeInt(d.step),
					cards: []
				};
			},
			update: (context, match) => {
				const event = match.event;
				const state = context.state;
				if (event.type !== "tool/ptc-dispatch") return state;
				const d = asRecord$1(event.data);
				if (d === null) return state;
				if (d.isError === true) return state;
				const subCallId = typeof d.subCallId === "string" && d.subCallId !== "" ? d.subCallId : "";
				if (subCallId === "") return state;
				const name = typeof d.name === "string" ? d.name : "";
				if (!CAMPUS_CARD_TOOLS.has(name)) return state;
				const block = {
					kind: "tool-result",
					callId: subCallId,
					call: {
						name,
						argsRaw: JSON.stringify(d.arguments) ?? ""
					},
					content: d.content,
					isError: false
				};
				return {
					...state,
					cards: [...state.cards, block]
				};
			},
			publication: () => "none",
			buildLocationData: (context, scope, previous) => {
				if (scope !== "step") return null;
				const state = context.state;
				if (state === void 0 || state.cards.length === 0) return null;
				if (state.turn === void 0 || state.step === void 0) return null;
				if (previous !== null && previous.kind === "step" && previous.key === "campus-cards-ptc") {
					const value = asRecord$1(previous.value);
					if (value !== null && value.cards === state.cards) return previous;
				}
				return {
					kind: "step",
					turn: state.turn,
					step: state.step,
					key: "campus-cards-ptc",
					value: { cards: state.cards }
				};
			}
		};
		//#endregion
		//#region src/client/JobCards.tsx
		/**
		* dsh-campus-hunt · 校招岗位三 tab 卡片（v0.1，client 半场）。
		*
		* 一个组件服务 4 个工具（会话节点注册，见 index.tsx，v0.1.1）：
		* campus_job_search / campus_job_detail / campus_schedule / job_track。
		* 分支依据 host 侧 presentationMeta 投影（block.meta.card:
		* 'jobs' | 'job' | 'schedule' | 'tracks'）；meta 缺失/畸形时回退解析
		* content[0].text 的规范值 JSON；再失败则渲染自绘 generic 行——
		* 永不白屏、不抛到宿主。
		*
		* 数据形态对齐工具规范值（src/nowcoder/types.ts）：
		* - jobs:     { jobs, merged, duplicates }
		* - job:      { jobId, job（含 jd 的完整 Job） }
		* - schedule: { items, source }
		* - tracks:   { tracks, summary }
		* 逐条校验（job: id+company+title；track: id+company+title+status；
		* item: company+type+source），坏元素跳过，全坏 → generic。
		*
		* 交互 local-first：activeTab / 选中行 / localStatus（本地状态标记）全部是
		* 组件本地 state（零往返）；只有三个 [campus-hunt-action] 提示词走会话面
		* （写入追踪 / 重新采集 JD / 追踪该岗位），mode 固定 'queue'。
		*
		* 会话面 = inject 面产物 `sendPrompt?: (text) => void`（见 index.tsx）：
		* 框架解析的 sessionId 被 inject 工厂闭包捕获，内部经 sessions 服务的
		* prompt 通道入队；组件不接触任何会话 hook。sendPrompt 缺失（非框架
		* 渲染 / sessions 面不可用）时三个动作按钮统一禁用。
		*
		* 类型自写口径：本插件 node_modules 不装 @deepseek-ai/dsh-client-ui-chat /
		* dsh-api-session-controller（import type 也解析失败），故按 wire 形态自写
		* 最小结构接口（与 records.ts / session.ts 对齐）。
		*
		* 样式遵循 DSH 外部插件惯例：内联样式、内联中文、透明底、无 locale。
		*
		* v0.1.3：PTC 文件分支——PTC 工具呈现下 host 不对子调用投影
		* presentationMeta（block.meta 缺席），且 content 是人类可读文本而非规范值
		* JSON，parseCard 必落 generic 行。规范值的唯一无损来源 = 会话 workspace
		* 文件：meta 缺席且 loader 可用（inject 面 loadWorkspaceFile，见 index.tsx）
		* 时，活读 jobs.json / track.json / schedule.json，构造规范值，复用同一卡片
		* 体（CardBody）；任何失败回退 generic 行，native 呈现（meta 在）不受影响。
		*/
		const KIND_BY_TOOL = {
			campus_job_search: "jobs",
			campus_job_detail: "job",
			campus_schedule: "schedule",
			job_track: "tracks"
		};
		function asRecord(v) {
			return v !== null && typeof v === "object" && !Array.isArray(v) ? v : null;
		}
		/** 非空字符串；否则 null。 */
		function str(v) {
			return typeof v === "string" && v.length > 0 ? v : null;
		}
		function num(v) {
			return typeof v === "number" && Number.isFinite(v) ? v : null;
		}
		/** 行数组：保留字符串元素；非数组 → null。 */
		function strLines(v) {
			return Array.isArray(v) ? v.filter((x) => typeof x === "string") : null;
		}
		function isJobLike(v) {
			const r = asRecord(v);
			return r !== null && str(r.id) !== null && str(r.company) !== null && str(r.title) !== null;
		}
		function isTrackLike(v) {
			const r = asRecord(v);
			return r !== null && str(r.id) !== null && str(r.company) !== null && str(r.title) !== null && str(r.status) !== null;
		}
		function isItemLike(v) {
			const r = asRecord(v);
			return r !== null && str(r.company) !== null && str(r.type) !== null && str(r.source) !== null;
		}
		function firstContentText(content) {
			if (!Array.isArray(content)) return null;
			for (const b of content) {
				const r = asRecord(b);
				if (r !== null && r.type === "text" && typeof r.text === "string") return r.text;
			}
			return null;
		}
		/**
		* 把已落定 block 解析为卡片数据；null → 调用方渲染 generic 行
		* （isError / 未知工具 / meta 与 content 都畸形）。
		* 分支优先级：block.meta（host 投影）→ content[0].text（规范值 JSON 回退）。
		*/
		function parseCard(tool, block) {
			if (!("kind" in block)) return null;
			const settled = block;
			if (settled.isError) return null;
			const meta = asRecord(settled.meta);
			if (meta !== null) {
				const card = meta.card;
				if (card === "jobs" || card === "job" || card === "schedule" || card === "tracks") {
					const parsed = parseCanonical(tool, card, meta);
					if (parsed !== null) return parsed;
				}
			}
			const text = firstContentText(settled.content);
			if (text !== null) {
				let value;
				try {
					value = JSON.parse(text);
				} catch {
					return null;
				}
				const r = asRecord(value);
				if (r !== null) {
					const kind = KIND_BY_TOOL[tool];
					if (kind !== void 0) {
						const parsed = parseCanonical(tool, kind, r);
						if (parsed !== null) return parsed;
					}
				}
			}
			return null;
		}
		function parseCanonical(tool, kind, v) {
			const base = {
				kind,
				tool,
				jobs: [],
				job: null,
				items: [],
				tracks: [],
				summary: null,
				merged: null,
				duplicates: null,
				source: "",
				jobId: ""
			};
			switch (kind) {
				case "jobs": {
					if (!Array.isArray(v.jobs)) return null;
					const arr = v.jobs;
					if (arr.length > 0 && !arr.some(isJobLike)) return null;
					base.jobs = arr.filter(isJobLike);
					base.merged = num(v.merged);
					base.duplicates = num(v.duplicates);
					break;
				}
				case "job": {
					if (!isJobLike(v.job)) return null;
					const job = v.job;
					base.job = job;
					base.jobId = str(v.jobId) ?? job.id;
					break;
				}
				case "schedule": {
					if (!Array.isArray(v.items)) return null;
					const arr = v.items;
					if (arr.length > 0 && !arr.some(isItemLike)) return null;
					base.items = arr.filter(isItemLike);
					base.source = str(v.source) ?? "";
					break;
				}
				case "tracks": {
					if (!Array.isArray(v.tracks)) return null;
					const arr = v.tracks;
					if (arr.length > 0 && !arr.some(isTrackLike)) return null;
					base.tracks = arr.filter(isTrackLike);
					const s = asRecord(v.summary);
					const byStatus = s !== null ? asRecord(s.byStatus) : null;
					if (s !== null && byStatus !== null) base.summary = {
						byStatus,
						total: num(s.total) ?? void 0
					};
					break;
				}
			}
			return base;
		}
		/** kind → 会话 workspace 文件名（store 层三个数据文件，见 src/data/store.ts）。 */
		function ptcFileForKind(kind) {
			if (kind === "tracks") return "track.json";
			if (kind === "schedule") return "schedule.json";
			return "jobs.json";
		}
		/**
		* PTC 文件分支门禁（全部满足才进）：block 已落定、isError false、meta 缺席
		* （= PTC 呈现；native 恒有 meta）、工具为 4 个 campus 卡之一、loader 可用。
		*/
		function ptcFileGate(tool, block, hasLoader) {
			if (!("kind" in block)) return false;
			const settled = block;
			if (settled.isError) return false;
			if (asRecord(settled.meta) !== null) return false;
			if (KIND_BY_TOOL[tool] === void 0) return false;
			return hasLoader;
		}
		/** 从 PTC dispatch 的 argsRaw 提取非空 jobId 字符串；缺席 / 畸形 / 非 JSON → null。 */
		function ptcJobIdFromArgs(argsRaw) {
			if (argsRaw === void 0 || argsRaw.length === 0) return null;
			try {
				const r = asRecord(JSON.parse(argsRaw));
				return r === null ? null : str(r.jobId);
			} catch {
				return null;
			}
		}
		/**
		* 会话 workspace 文件文本 → 规范值（字段名对齐 parseCanonical 期望）：先解
		* store 信封（{ schema, data } → data，容忍裸对象），再按 kind 构造：
		* - jobs:     { jobs }（数组，缺失 → null）
		* - tracks:   { tracks, summary: { byStatus: 按 track.status 计数, total: tracks.length } }
		* - schedule: { items, source: 首项 source（string，缺失 → ''）}（文件无顶层 source）
		* - job:      需 argsRaw（jobId），jobs 中按 id 找 → { job, jobId }；未找到 → null
		* JSON 解析失败 / 根非对象 / data 非对象 → null；逐元素校验由 parseCanonical
		* 既有检查兜底（本函数只做构造）。
		*/
		function ptcCanonicalFromFile(kind, fileText, argsRaw) {
			let root;
			try {
				root = JSON.parse(fileText);
			} catch {
				return null;
			}
			const obj = asRecord(root);
			if (obj === null) return null;
			const data = asRecord(obj.data) ?? obj;
			switch (kind) {
				case "jobs":
					if (!Array.isArray(data.jobs)) return null;
					return { jobs: data.jobs };
				case "tracks": {
					if (!Array.isArray(data.tracks)) return null;
					const tracks = data.tracks;
					const byStatus = {};
					for (const t of tracks) {
						const s = str(asRecord(t)?.status);
						if (s !== null) byStatus[s] = (byStatus[s] ?? 0) + 1;
					}
					return {
						tracks,
						summary: {
							byStatus,
							total: tracks.length
						}
					};
				}
				case "schedule": {
					if (!Array.isArray(data.items)) return null;
					const items = data.items;
					return {
						items,
						source: str(asRecord(items[0])?.source) ?? ""
					};
				}
				case "job": {
					const jobId = ptcJobIdFromArgs(argsRaw);
					if (jobId === null) return null;
					if (!Array.isArray(data.jobs)) return null;
					const found = data.jobs.find((x) => asRecord(x)?.id === jobId);
					if (found === void 0) return null;
					return {
						job: found,
						jobId
					};
				}
			}
		}
		const STATUS_ORDER = [
			"未处理",
			"已投递",
			"笔试",
			"面试",
			"已拒",
			"offer"
		];
		const STATUS_COLORS = {
			未处理: "#6b7484",
			已投递: "#4d8fd1",
			笔试: "#c9974b",
			面试: "#9a6fd1",
			已拒: "#d15454",
			offer: "#4dbd74"
		};
		const STATUS_FALLBACK_COLOR = "#5a6472";
		const TITLE_BY_KIND = {
			jobs: "校招岗位搜索",
			job: "岗位详情",
			schedule: "校招日程",
			tracks: "投递追踪"
		};
		const JD_LINE_LIMIT = 8;
		const cardStyle = {
			background: "transparent",
			border: "1px solid rgba(255,255,255,0.14)",
			borderRadius: 8,
			padding: 10,
			fontFamily: "system-ui, -apple-system, \"Segoe UI\", sans-serif",
			fontSize: 12,
			color: "#e8eaf0",
			lineHeight: 1.55,
			maxWidth: 720,
			boxSizing: "border-box"
		};
		const headerStyle = {
			display: "flex",
			alignItems: "center",
			gap: 6,
			marginBottom: 8
		};
		const iconStyle = {
			color: "#8a93a6",
			fontSize: 13
		};
		const titleStyle = {
			fontSize: 13,
			fontWeight: 600
		};
		const mutedStyle$1 = {
			color: "#8a93a6",
			fontSize: 11
		};
		const dotStyle = (color) => ({
			width: 8,
			height: 8,
			borderRadius: "50%",
			background: color,
			display: "inline-block",
			flexShrink: 0
		});
		const tabBarStyle = {
			display: "flex",
			gap: 6,
			marginBottom: 8
		};
		const tabBtnStyle = (active) => ({
			padding: "3px 10px",
			fontSize: 12,
			borderRadius: 6,
			cursor: "pointer",
			background: active ? "rgba(91,155,213,0.22)" : "transparent",
			border: active ? "1px solid rgba(91,155,213,0.55)" : "1px solid rgba(255,255,255,0.14)",
			color: active ? "#cfe4f7" : "#a8b0c0"
		});
		const tableStyle = {
			width: "100%",
			borderCollapse: "collapse",
			fontSize: 12
		};
		const thStyle = {
			textAlign: "left",
			padding: "4px 8px",
			color: "#8a93a6",
			fontWeight: 500,
			borderBottom: "1px solid rgba(255,255,255,0.14)"
		};
		const tdStyle = {
			padding: "5px 8px",
			borderBottom: "1px solid rgba(255,255,255,0.07)",
			verticalAlign: "top"
		};
		const rowStyle = (selected) => ({
			cursor: "pointer",
			background: selected ? "rgba(91,155,213,0.12)" : "transparent"
		});
		const badgeStyle = (status) => ({
			display: "inline-block",
			padding: "1px 8px",
			borderRadius: 10,
			fontSize: 11,
			color: "#ffffff",
			background: STATUS_COLORS[status] ?? STATUS_FALLBACK_COLOR
		});
		const smallBtnStyle = {
			marginTop: 6,
			padding: "3px 10px",
			fontSize: 11,
			borderRadius: 6,
			cursor: "pointer",
			background: "transparent",
			border: "1px solid rgba(255,255,255,0.25)",
			color: "#c9d1e0"
		};
		const actionBtnStyle = (enabled) => ({
			...smallBtnStyle,
			cursor: enabled ? "pointer" : "not-allowed",
			opacity: enabled ? 1 : .45,
			borderColor: enabled ? "rgba(91,155,213,0.6)" : "rgba(255,255,255,0.18)",
			color: enabled ? "#cfe4f7" : "#77808f"
		});
		const preStyle = {
			marginTop: 6,
			padding: 8,
			borderRadius: 6,
			background: "rgba(0,0,0,0.3)",
			border: "1px solid rgba(255,255,255,0.1)",
			fontSize: 11,
			whiteSpace: "pre-wrap",
			wordBreak: "break-all",
			maxHeight: 240,
			overflow: "auto",
			color: "#a8b0c0"
		};
		const sectionTitleStyle$1 = {
			fontWeight: 600,
			fontSize: 12,
			margin: "8px 0 4px",
			color: "#c9d1e0"
		};
		const sectionWrapStyle = { marginBottom: 4 };
		const jdLineStyle = {
			padding: "1px 0",
			color: "#d6dae4"
		};
		const detailTitleStyle = {
			fontSize: 13,
			fontWeight: 600,
			marginBottom: 4
		};
		const hintStyle = {
			color: "#8a93a6",
			fontSize: 12,
			padding: "8px 0"
		};
		const kvRowStyle = {
			display: "flex",
			gap: 8,
			padding: "3px 0",
			borderBottom: "1px solid rgba(255,255,255,0.06)"
		};
		const kvLabelStyle = {
			color: "#8a93a6",
			width: 64,
			flexShrink: 0
		};
		const linkStyle = {
			color: "#7fb3e0",
			textDecoration: "none",
			wordBreak: "break-all"
		};
		const statusBtnRowStyle = {
			display: "flex",
			gap: 5,
			flexWrap: "wrap",
			margin: "4px 0 8px"
		};
		const statusBtnStyle = (active, status) => ({
			padding: "2px 9px",
			fontSize: 11,
			borderRadius: 10,
			cursor: "pointer",
			color: active ? "#ffffff" : "#a8b0c0",
			background: active ? STATUS_COLORS[status] ?? "rgba(255,255,255,0.2)" : "transparent",
			border: "1px solid rgba(255,255,255,0.22)"
		});
		const statGridStyle = {
			display: "flex",
			gap: 6,
			flexWrap: "wrap",
			marginBottom: 8
		};
		const statCellStyle = {
			flex: "1 1 auto",
			minWidth: 72,
			textAlign: "center",
			padding: "6px 4px",
			border: "1px solid rgba(255,255,255,0.12)",
			borderRadius: 6,
			background: "rgba(255,255,255,0.03)"
		};
		const statNumStyle = {
			fontSize: 15,
			fontWeight: 600
		};
		const statLabelStyle = (status) => ({
			fontSize: 11,
			color: STATUS_COLORS[status] ?? STATUS_FALLBACK_COLOR
		});
		const timelineRowStyle = {
			display: "flex",
			alignItems: "center",
			gap: 8,
			padding: "5px 0",
			borderBottom: "1px solid rgba(255,255,255,0.07)"
		};
		const noteStyle = {
			color: "#a8b0c0",
			fontSize: 11,
			padding: "2px 0 0 24px"
		};
		function JobCards(props) {
			try {
				return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(JobCardsInner, { ...props });
			} catch (error) {
				return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(CrashRow, {
					toolName: props.toolName,
					error
				});
			}
		}
		function rowsOf(parsed) {
			if (parsed.kind === "schedule") return parsed.items.map((it) => ({
				key: it.company,
				company: it.company,
				title: it.type,
				deadline: it.openDate ?? "",
				baseStatus: ""
			}));
			if (parsed.kind === "job" && parsed.job !== null) {
				const j = parsed.job;
				return [{
					key: j.id,
					company: j.company,
					title: j.title,
					city: j.city,
					salary: j.salary,
					deadline: j.deadline ?? "",
					baseStatus: "未处理"
				}];
			}
			if (parsed.kind === "jobs") return parsed.jobs.map((j) => ({
				key: j.id,
				company: j.company,
				title: j.title,
				city: j.city,
				salary: j.salary,
				deadline: j.deadline ?? "",
				baseStatus: "未处理"
			}));
			return parsed.tracks.map((t) => ({
				key: t.id,
				company: t.company,
				title: t.title,
				deadline: t.deadline ?? "",
				baseStatus: t.status
			}));
		}
		function jobOf(parsed, key) {
			if (key === null) return null;
			if (parsed.kind === "job") return parsed.job;
			if (parsed.kind === "jobs") return parsed.jobs.find((j) => j.id === key) ?? null;
			if (parsed.kind === "tracks") {
				const t = parsed.tracks.find((x) => x.id === key);
				if (t === void 0) return null;
				return {
					id: t.id,
					company: t.company,
					title: t.title,
					deadline: t.deadline
				};
			}
			return null;
		}
		function itemOf(parsed, key) {
			if (key === null || parsed.kind !== "schedule") return null;
			return parsed.items.find((it) => it.company === key) ?? null;
		}
		function statusCounts(parsed, localStatus) {
			const counts = {};
			for (const s of STATUS_ORDER) counts[s] = 0;
			if (Object.keys(localStatus).length === 0) {
				if (parsed.summary !== null) for (const s of STATUS_ORDER) {
					const v = parsed.summary.byStatus[s];
					counts[s] = typeof v === "number" ? v : 0;
				}
				else for (const t of parsed.tracks) counts[t.status] = (counts[t.status] ?? 0) + 1;
				return counts;
			}
			const known = /* @__PURE__ */ new Set();
			for (const t of parsed.tracks) {
				const eff = localStatus[t.id] ?? t.status;
				counts[eff] = (counts[eff] ?? 0) + 1;
				known.add(t.id);
			}
			for (const [id, s] of Object.entries(localStatus)) if (!known.has(id)) counts[s] = (counts[s] ?? 0) + 1;
			return counts;
		}
		function countText(parsed) {
			if (parsed.kind === "jobs") {
				let t = `${parsed.jobs.length} 个岗位`;
				if (parsed.merged !== null && parsed.merged > 0) t += ` · 新增 ${parsed.merged}`;
				if (parsed.duplicates !== null && parsed.duplicates > 0) t += ` · 去重 ${parsed.duplicates}`;
				return t;
			}
			if (parsed.kind === "job") return "岗位详情";
			if (parsed.kind === "schedule") return `${parsed.items.length} 家公司`;
			return `${parsed.summary !== null && typeof parsed.summary.total === "number" ? parsed.summary.total : parsed.tracks.length} 条追踪`;
		}
		function JobCardsInner(props) {
			const { toolName, block } = props;
			const send = props.sendPrompt ?? null;
			const loader = props.loadWorkspaceFile;
			const hasLoader = loader !== void 0;
			const parsed = parseCard(toolName, block);
			if (parsed === null) {
				if (!("kind" in block)) return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(RunningRow, {
					toolName,
					block
				});
				if (hasLoader && ptcFileGate(toolName, block, hasLoader)) return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(PtcFileCard, {
					toolName,
					block,
					loadWorkspaceFile: loader,
					send
				});
				return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(GenericRow, {
					toolName,
					block
				});
			}
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(CardBody, {
				parsed,
				send
			});
		}
		/**
		* 卡片体（v0.1.3 提取；native meta / content 规范值 / PTC 文件分支三路共享）：
		* 四个 state hooks 随体走；渲染 JSX 为原 JobCardsInner 卡片体原样搬移。
		*/
		function CardBody(props) {
			const { parsed, send } = props;
			const [activeTab, setActiveTab] = (0, react.useState)(0);
			const [selectedId, setSelectedId] = (0, react.useState)(null);
			const [localStatus, setLocalStatus] = (0, react.useState)({});
			const [expandedSections, setExpandedSections] = (0, react.useState)({});
			const rows = rowsOf(parsed);
			const selectRow = (key) => {
				setSelectedId(key);
				setActiveTab(1);
			};
			const selectedJob = jobOf(parsed, selectedId);
			const selectedRow = selectedId === null ? null : rows.find((r) => r.key === selectedId) ?? null;
			const currentStatus = selectedJob === null ? "" : localStatus[selectedJob.id] ?? (selectedRow?.baseStatus || "未处理");
			const selectedItem = itemOf(parsed, selectedId);
			const openDetailTab = () => {
				setActiveTab(1);
				if (selectedId === null && rows.length > 0) setSelectedId(rows[0].key);
			};
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				style: cardStyle,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						style: headerStyle,
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								style: iconStyle,
								children: "✦"
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								style: titleStyle,
								children: TITLE_BY_KIND[parsed.kind]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { style: dotStyle("#4dbd74") }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								style: mutedStyle$1,
								children: countText(parsed)
							})
						]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						style: tabBarStyle,
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								style: tabBtnStyle(activeTab === 0),
								onClick: () => setActiveTab(0),
								children: "岗位列表"
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								style: tabBtnStyle(activeTab === 1),
								onClick: openDetailTab,
								children: "岗位详情"
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								style: tabBtnStyle(activeTab === 2),
								onClick: () => setActiveTab(2),
								children: "投递追踪"
							})
						]
					}),
					activeTab === 0 && (parsed.kind === "schedule" ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("table", {
						style: tableStyle,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("thead", { children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("tr", { children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("th", {
								style: thStyle,
								children: "公司"
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("th", {
								style: thStyle,
								children: "批次"
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("th", {
								style: thStyle,
								children: "收录"
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("th", {
								style: thStyle,
								children: "地点"
							})
						] }) }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("tbody", { children: [parsed.items.map((it) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("tr", {
							style: rowStyle(it.company === selectedId),
							onClick: () => selectRow(it.company),
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("td", {
									style: tdStyle,
									children: it.company
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("td", {
									style: tdStyle,
									children: it.type
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("td", {
									style: tdStyle,
									children: it.openDate ?? "—"
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("td", {
									style: tdStyle,
									children: it.cities ?? "—"
								})
							]
						}, it.company)), parsed.items.length === 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("tr", { children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("td", {
							style: tdStyle,
							colSpan: 4,
							children: "暂无日程数据"
						}) })] })]
					}) : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("table", {
						style: tableStyle,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("thead", { children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("tr", { children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("th", {
								style: thStyle,
								children: "公司"
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("th", {
								style: thStyle,
								children: "岗位"
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("th", {
								style: thStyle,
								children: "城市"
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("th", {
								style: thStyle,
								children: "薪资"
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("th", {
								style: thStyle,
								children: "截止"
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("th", {
								style: thStyle,
								children: "状态"
							})
						] }) }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("tbody", { children: [rows.map((r) => {
							const eff = localStatus[r.key] ?? (r.baseStatus || "未处理");
							return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("tr", {
								style: rowStyle(r.key === selectedId),
								onClick: () => selectRow(r.key),
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("td", {
										style: tdStyle,
										children: r.company
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("td", {
										style: tdStyle,
										children: r.title
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("td", {
										style: tdStyle,
										children: r.city || "—"
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("td", {
										style: tdStyle,
										children: r.salary || "—"
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("td", {
										style: tdStyle,
										children: r.deadline || "—"
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("td", {
										style: tdStyle,
										children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											style: badgeStyle(eff),
											children: eff
										})
									})
								]
							}, r.key);
						}), rows.length === 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("tr", { children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("td", {
							style: tdStyle,
							colSpan: 6,
							children: "暂无岗位"
						}) })] })]
					})),
					activeTab === 1 && (parsed.kind === "schedule" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ScheduleDetail, { item: selectedItem }) : selectedJob === null ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						style: hintStyle,
						children: "请选择一行查看岗位详情"
					}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)(JobDetail, {
						job: selectedJob,
						currentStatus,
						send,
						expandedSections,
						onToggleSection: (k) => setExpandedSections((p) => ({
							...p,
							[k]: p[k] !== true
						})),
						onStatus: (s) => {
							setLocalStatus((prev) => ({
								...prev,
								[selectedJob.id]: s
							}));
						}
					})),
					activeTab === 2 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(TracksTab, {
						parsed,
						localStatus,
						selectedJob,
						send
					})
				]
			});
		}
		/**
		* v0.1.3 PTC 文件分支：活读会话 workspace 文件（loader = inject 面产物）→
		* 构造规范值 → 复用 CardBody。加载态 = 最小行（无 tab）；任何失败（loader
		* throw / 文件缺席 / 非 JSON / 构造或校验失败）→ GenericRow 兜底，永不白屏。
		*/
		function PtcFileCard(props) {
			const { toolName, block, loadWorkspaceFile, send } = props;
			const kind = KIND_BY_TOOL[toolName];
			const argsRaw = block.call !== null ? block.call.argsRaw : void 0;
			const jobId = ptcJobIdFromArgs(argsRaw);
			const immediateGeneric = kind === "job" && jobId === null;
			const [state, setState] = (0, react.useState)("loading");
			(0, react.useEffect)(() => {
				if (immediateGeneric) return;
				let cancelled = false;
				loadWorkspaceFile(ptcFileForKind(kind)).then((fileText) => {
					if (cancelled) return;
					if (fileText === null) {
						setState(null);
						return;
					}
					const canonical = ptcCanonicalFromFile(kind, fileText, argsRaw);
					if (canonical === null) {
						setState(null);
						return;
					}
					setState(parseCanonical(toolName, kind, canonical));
				}).catch(() => {
					if (!cancelled) setState(null);
				});
				return () => {
					cancelled = true;
				};
			}, []);
			if (immediateGeneric) return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(GenericRow, {
				toolName,
				block
			});
			if (state === "loading") return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				style: cardStyle,
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					style: headerStyle,
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							style: iconStyle,
							children: "✦"
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							style: titleStyle,
							children: TITLE_BY_KIND[kind]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { style: dotStyle("#4dbd74") }),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							style: mutedStyle$1,
							children: "卡片加载…"
						})
					]
				})
			});
			if (state === null) return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(GenericRow, {
				toolName,
				block
			});
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(CardBody, {
				parsed: state,
				send
			});
		}
		function JdSection(props) {
			const { title, lines, expanded, onToggle } = props;
			const overflow = lines.length > JD_LINE_LIMIT;
			const visible = overflow && !expanded ? lines.slice(0, JD_LINE_LIMIT) : lines;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				style: sectionWrapStyle,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						style: sectionTitleStyle$1,
						children: [
							title,
							"（",
							lines.length,
							" 行）"
						]
					}),
					visible.map((line, i) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						"data-jd-line": "1",
						style: jdLineStyle,
						children: line
					}, i)),
					overflow && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
						style: smallBtnStyle,
						onClick: onToggle,
						children: expanded ? "收起" : `展开（${lines.length - JD_LINE_LIMIT} 行）`
					})
				]
			});
		}
		function JobDetail(props) {
			const { job, currentStatus, send, expandedSections, onToggleSection, onStatus } = props;
			const desc = strLines(job.jd?.description);
			const req = strLines(job.jd?.requirements);
			const bonus = strLines(job.jd?.bonus);
			const hasJd = desc !== null && desc.length > 0 || req !== null && req.length > 0;
			const recollectObj = { jobId: job.id };
			if (job.url !== void 0 && job.url !== "") recollectObj.url = job.url;
			const trackObj = {
				jobId: job.id,
				company: job.company,
				title: job.title,
				status: currentStatus
			};
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [
				/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					style: detailTitleStyle,
					children: [
						job.company,
						" · ",
						job.title
					]
				}),
				hasJd ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
					desc !== null && desc.length > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(JdSection, {
						title: "岗位职责",
						lines: desc,
						expanded: expandedSections.desc === true,
						onToggle: () => onToggleSection("desc")
					}),
					req !== null && req.length > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(JdSection, {
						title: "岗位要求",
						lines: req,
						expanded: expandedSections.req === true,
						onToggle: () => onToggleSection("req")
					}),
					bonus !== null && bonus.length > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(JdSection, {
						title: "加分项",
						lines: bonus,
						expanded: expandedSections.bonus === true,
						onToggle: () => onToggleSection("bonus")
					})
				] }) : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					style: sectionWrapStyle,
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							style: sectionTitleStyle$1,
							children: "JD"
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							style: mutedStyle$1,
							children: "暂无 JD 详情"
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							style: actionBtnStyle(send !== null),
							disabled: send === null,
							onClick: () => send?.(`[campus-hunt-action] campus_hunt.recollect_jd ${JSON.stringify(recollectObj)}\n请按 campus-hunt skill 重新采集该岗位 JD 并调用 campus_job_detail。`),
							children: "重新采集 JD"
						})
					]
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					style: sectionTitleStyle$1,
					children: "投递窗口"
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					style: kvRowStyle,
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						style: kvLabelStyle,
						children: "截止日期"
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: job.deadline ?? "未标注" })]
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					style: kvRowStyle,
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						style: kvLabelStyle,
						children: "届别"
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: job.graduationYear ?? "未标注" })]
				}),
				job.city !== void 0 && job.city !== "" && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					style: kvRowStyle,
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						style: kvLabelStyle,
						children: "城市"
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: job.city })]
				}),
				job.salary !== void 0 && job.salary !== "" && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					style: kvRowStyle,
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						style: kvLabelStyle,
						children: "薪资"
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: job.salary })]
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					style: kvRowStyle,
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						style: kvLabelStyle,
						children: "牛客页面"
					}), job.url !== void 0 && job.url !== "" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("a", {
						href: job.url,
						target: "_blank",
						rel: "noreferrer",
						style: linkStyle,
						children: job.url
					}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						style: mutedStyle$1,
						children: "未标注"
					})]
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					style: sectionTitleStyle$1,
					children: ["状态标记 ", /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						style: badgeStyle(currentStatus),
						"data-status-badge": true,
						children: currentStatus
					})]
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					style: statusBtnRowStyle,
					children: STATUS_ORDER.map((s) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
						style: statusBtnStyle(s === currentStatus, s),
						onClick: () => onStatus(s),
						children: s
					}, s))
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
					style: actionBtnStyle(send !== null),
					disabled: send === null,
					onClick: () => send?.(`[campus-hunt-action] campus_hunt.track_status ${JSON.stringify(trackObj)}\n请用 job_track 将该岗位状态更新为 ${currentStatus}。`),
					children: "写入追踪"
				})
			] });
		}
		function ScheduleDetail(props) {
			const item = props.item;
			if (item === null) return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				style: hintStyle,
				children: "请选择一行查看日程详情"
			});
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					style: detailTitleStyle,
					children: item.company
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					style: kvRowStyle,
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						style: kvLabelStyle,
						children: "批次"
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: item.type })]
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					style: kvRowStyle,
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						style: kvLabelStyle,
						children: "收录日期"
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: item.openDate ?? "未标注" })]
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					style: kvRowStyle,
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						style: kvLabelStyle,
						children: "地点"
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: item.cities ?? "未标注" })]
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					style: kvRowStyle,
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						style: kvLabelStyle,
						children: "来源"
					}), item.source !== "" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("a", {
						href: item.source,
						target: "_blank",
						rel: "noreferrer",
						style: linkStyle,
						children: item.source
					}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						style: mutedStyle$1,
						children: "未标注"
					})]
				})
			] });
		}
		function TracksTab(props) {
			const { parsed, localStatus, selectedJob, send } = props;
			const counts = statusCounts(parsed, localStatus);
			const timeline = [...parsed.tracks].sort((a, b) => String(b.updatedAt ?? "").localeCompare(String(a.updatedAt ?? "")));
			const empty = timeline.length === 0 && Object.keys(localStatus).length === 0;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				style: statGridStyle,
				children: STATUS_ORDER.map((s) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					style: statCellStyle,
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						style: statNumStyle,
						"data-status-count": s,
						children: counts[s] ?? 0
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						style: statLabelStyle(s),
						children: s
					})]
				}, s))
			}), empty ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				style: mutedStyle$1,
				children: "暂无投递追踪"
			}), selectedJob !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
				style: actionBtnStyle(send !== null),
				disabled: send === null,
				onClick: () => send?.(`[campus-hunt-action] campus_hunt.track_add ${JSON.stringify({
					jobId: selectedJob.id,
					company: selectedJob.company,
					title: selectedJob.title
				})}\n请用 job_track 新增该岗位（状态 未处理）。`),
				children: "追踪该岗位"
			})] }) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", { children: timeline.map((t) => {
				const eff = localStatus[t.id] ?? t.status;
				return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					style: timelineRowStyle,
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							style: badgeStyle(eff),
							children: eff
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
							style: { flex: 1 },
							children: [
								t.company,
								" · ",
								t.title
							]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							style: mutedStyle$1,
							children: t.updatedAt ?? ""
						})
					]
				}), t.note !== void 0 && t.note !== "" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					style: noteStyle,
					children: t.note
				})] }, t.id);
			}) })] });
		}
		/** 已落定但解析失败（isError / 未知工具 / meta 与 content 都畸形）：自绘 generic 行。 */
		function GenericRow(props) {
			const { toolName, block } = props;
			const [expanded, setExpanded] = (0, react.useState)(false);
			const text = firstContentText(block.content) ?? "";
			const summary = block.isError ? `调用失败${block.error !== void 0 ? ` · ${block.error.name} · ${block.error.code}` : ""}` : text.slice(0, 200);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				style: cardStyle,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						style: headerStyle,
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								style: iconStyle,
								children: "✦"
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								style: titleStyle,
								children: toolName
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { style: dotStyle(block.isError ? "#d15454" : "#4dbd74") }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								style: {
									...mutedStyle$1,
									color: block.isError ? "#d15454" : "#8a93a6",
									flex: 1,
									overflow: "hidden",
									textOverflow: "ellipsis",
									whiteSpace: "nowrap"
								},
								children: summary
							})
						]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
						style: smallBtnStyle,
						onClick: () => setExpanded((v) => !v),
						children: expanded ? "收起" : "展开"
					}),
					expanded && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("pre", {
						style: preStyle,
						children: [block.call !== null ? `args: ${block.call.argsRaw}\n` : "", block.content.map(describeBlock).join("\n")]
					})
				]
			});
		}
		function describeBlock(b) {
			const r = asRecord(b);
			if (r !== null && r.type === "text" && typeof r.text === "string") return r.text;
			return `[${r !== null && typeof r.type === "string" ? r.type : "block"}]`;
		}
		/** 运行中：等待行（argsRaw 截断）。 */
		function RunningRow(props) {
			const { toolName, block } = props;
			const [expanded, setExpanded] = (0, react.useState)(false);
			const args = block.argsRaw.length > 120 ? `${block.argsRaw.slice(0, 120)}…` : block.argsRaw;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				style: cardStyle,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						style: headerStyle,
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								style: iconStyle,
								children: "✦"
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								style: titleStyle,
								children: toolName
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { style: dotStyle("#4d8fd1") }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								style: {
									...mutedStyle$1,
									flex: 1,
									overflow: "hidden",
									textOverflow: "ellipsis",
									whiteSpace: "nowrap"
								},
								children: expanded ? args : `正在调用 ${toolName}…`
							})
						]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
						style: smallBtnStyle,
						onClick: () => setExpanded((v) => !v),
						children: expanded ? "收起" : "展开"
					}),
					expanded && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("pre", {
						style: preStyle,
						children: block.argsRaw
					})
				]
			});
		}
		/** 渲染崩溃兜底：最小 generic 行，永不白屏。 */
		function CrashRow(props) {
			const msg = props.error instanceof Error ? props.error.message : String(props.error);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				style: cardStyle,
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					style: headerStyle,
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							style: iconStyle,
							children: "✦"
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							style: titleStyle,
							children: props.toolName
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { style: dotStyle("#d15454") }),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
							style: {
								...mutedStyle$1,
								color: "#d15454"
							},
							children: ["卡片渲染失败：", msg]
						})
					]
				})
			});
		}
		//#endregion
		//#region src/client/settings.tsx
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
		* 读写通道（v0.1.4，0.1.7 client 契约 D3）：
		* - 读一律经 `useForm` selector hook（框架把 inject `hooks.form` 隔间的
		*   裸 observable——ConfigForm——绑定为 useForm）；组件内禁手动 subscribe /
		*   useSyncExternalStore。
		* - 本地 draft 暂存（useState）：未保存不写 form；分节保存按钮仅在该节
		*   有改动（dirty）时可用。
		* - 保存 = 逐顶层字段 `form.set(field, value)`；恢复默认 =
		*   `form.unset(field)`（清 user 层回 base 继承）。setField / resetField
		*   是 inject 工厂闭包里的薄封装（index.tsx）：透传 form 的
		*   Promise<boolean>，transport 失败 reject 归一为 false。连写保序 /
		*   revision fence / 失败镜像重读由 form 内建写队列承担（0.1.7
		*   ConfigFormController），插件侧无自写写编排。
		* - 未接受自愈：写返回 false（拒绝或跳写，form 已做 latest-write 恢复）→
		*   提示条 + draft 归零（回到最新快照，服务端为事实源）。
		* - status loading / unavailable /（ready 但 value 未解码）各有独立展示；
		*   writable=false 显示只读提示条 + 表单（全部输入与按钮禁用），不白屏。
		* - 覆盖标记（「已自定义」徽章）：snapshot.user 分节存在性——值与 base
		*   相等的覆盖也是覆盖（比较值看不见它）。
		*
		* 类型自写口径（同 JobCards.tsx）：本插件 node_modules 未装
		* @deepseek-ai/dsh-client-ui-settings，按 wire 形态自写最小结构接口
		* （ConfigFormLike / ConfigFormSnapshotLike / FormSelectorHook）。
		*/
		/** JSON 深比较（表单值均为 JSON 形态；undefined 两侧 stringify 均得 undefined）。 */
		function jsonEqual(a, b) {
			return JSON.stringify(a) === JSON.stringify(b);
		}
		/** 深拷贝一个 Config（数组逐层复制；draft 的创建与归零用）。 */
		function cloneConfig(c) {
			return {
				profile: {
					directions: [...c.profile.directions],
					cities: [...c.profile.cities],
					targetCompanies: [...c.profile.targetCompanies]
				},
				resumePath: c.resumePath,
				specialUrl: c.specialUrl,
				collection: {
					allowedDomains: [...c.collection.allowedDomains],
					maxItemsPerRun: c.collection.maxItemsPerRun,
					minIntervalMs: c.collection.minIntervalMs
				}
			};
		}
		/** 覆盖标记：user 层中该分节的存在性（值与 base 相等也是覆盖）。 */
		function isOverridden(user, field) {
			return user !== null && typeof user === "object" && !Array.isArray(user) && user[field] !== void 0;
		}
		const pageStyle = {
			padding: "4px 2px",
			fontFamily: "system-ui, -apple-system, \"Segoe UI\", sans-serif",
			fontSize: 12,
			color: "#e8eaf0",
			lineHeight: 1.55,
			maxWidth: 720,
			boxSizing: "border-box"
		};
		const sectionStyle = {
			border: "1px solid rgba(255,255,255,0.14)",
			borderRadius: 8,
			padding: 12,
			marginBottom: 10,
			background: "rgba(255,255,255,0.02)"
		};
		const sectionHeaderStyle = {
			display: "flex",
			alignItems: "center",
			gap: 8,
			marginBottom: 8
		};
		const sectionTitleStyle = {
			fontSize: 13,
			fontWeight: 600
		};
		const overrideBadgeStyle = {
			display: "inline-block",
			padding: "0 8px",
			borderRadius: 10,
			fontSize: 11,
			color: "#ffffff",
			background: "#9a6fd1"
		};
		const fieldStyle = { marginBottom: 10 };
		const labelStyle = {
			color: "#c9d1e0",
			fontWeight: 500,
			marginBottom: 4
		};
		const hintTextStyle = {
			color: "#8a93a6",
			fontSize: 11,
			marginBottom: 4
		};
		const chipRowStyle = {
			display: "flex",
			flexWrap: "wrap",
			gap: 6,
			alignItems: "center"
		};
		const chipStyle = {
			display: "inline-flex",
			alignItems: "center",
			gap: 4,
			padding: "1px 8px",
			borderRadius: 10,
			fontSize: 11,
			background: "rgba(91,155,213,0.18)",
			border: "1px solid rgba(91,155,213,0.45)",
			color: "#cfe4f7"
		};
		const chipXStyle = {
			background: "transparent",
			border: "none",
			color: "#a8b0c0",
			cursor: "pointer",
			fontSize: 12,
			lineHeight: 1,
			padding: 0
		};
		const inputStyle = {
			flex: 1,
			minWidth: 160,
			padding: "4px 8px",
			borderRadius: 6,
			fontSize: 12,
			color: "#e8eaf0",
			background: "rgba(0,0,0,0.25)",
			border: "1px solid rgba(255,255,255,0.18)",
			boxSizing: "border-box"
		};
		const numberRowStyle = {
			display: "flex",
			gap: 8,
			alignItems: "center"
		};
		const numberInputStyle = {
			width: 120,
			padding: "4px 8px",
			borderRadius: 6,
			fontSize: 12,
			color: "#e8eaf0",
			background: "rgba(0,0,0,0.25)",
			border: "1px solid rgba(255,255,255,0.18)",
			boxSizing: "border-box"
		};
		const sectionFootStyle = {
			display: "flex",
			gap: 8,
			marginTop: 4
		};
		const btnStyle = (enabled) => ({
			padding: "3px 12px",
			fontSize: 11,
			borderRadius: 6,
			cursor: enabled ? "pointer" : "not-allowed",
			opacity: enabled ? 1 : .45,
			background: "transparent",
			border: `1px solid ${enabled ? "rgba(91,155,213,0.6)" : "rgba(255,255,255,0.18)"}`,
			color: enabled ? "#cfe4f7" : "#77808f"
		});
		const noticeStyle = {
			color: "#8a93a6",
			fontSize: 12,
			padding: "8px 0"
		};
		const warnStyle = {
			padding: "6px 10px",
			borderRadius: 6,
			fontSize: 12,
			color: "#f0d9a8",
			background: "rgba(201,151,75,0.12)",
			border: "1px solid rgba(201,151,75,0.4)",
			marginBottom: 8
		};
		const mutedStyle = {
			color: "#8a93a6",
			fontSize: 11
		};
		/**
		* 设置页卡片（settings.section entry）。渲染只读 useForm selector；
		* 写经 setField / resetField 薄封装回调；draft 本地暂存。
		*/
		function CampusHuntSection(props) {
			const status = props.useForm((s) => s.status);
			const value = props.useForm((s) => s.value);
			const user = props.useForm((s) => s.user);
			const writable = props.useForm((s) => s.writable);
			const [draft, setDraft] = (0, react.useState)(null);
			const [busy, setBusy] = (0, react.useState)(null);
			const [writeRefused, setWriteRefused] = (0, react.useState)(false);
			if (status === "loading") return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				style: pageStyle,
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					style: noticeStyle,
					children: "正在加载设置…"
				})
			});
			if (status === "unavailable") return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				style: pageStyle,
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					style: warnStyle,
					children: "设置不可用：无法读取 Host 设置文档，或 dsh-campus-hunt 分节未注册。"
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					style: mutedStyle,
					children: "请确认 DSH web 服务运行正常，然后重开设置页。"
				})]
			});
			if (value === void 0) return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				style: pageStyle,
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					style: warnStyle,
					children: "设置分节解析失败（值与 schema 不一致）。"
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					style: mutedStyle,
					children: "请重启 DSH 让 host 重新注册 dsh-campus-hunt 分节后重试。"
				})]
			});
			const shown = draft ?? value;
			const isDirty = (field) => draft !== null && !jsonEqual(draft[field], value[field]);
			/** 保存一个顶层字段：写后 draft 归零回到最新快照；未接受（false）显示提示。 */
			const doSave = async (field) => {
				if (draft === null || !isDirty(field)) return;
				setBusy(field);
				setWriteRefused(false);
				const ok = await props.setField(field, draft[field]);
				setDraft(null);
				setBusy(null);
				if (!ok) setWriteRefused(true);
			};
			/** 恢复默认一个顶层字段（unset，清 user 层回 base 继承）。 */
			const doReset = async (field) => {
				setBusy(field);
				setWriteRefused(false);
				const ok = await props.resetField(field);
				setDraft(null);
				setBusy(null);
				if (!ok) setWriteRefused(true);
			};
			const patchProfileList = (key, tag) => {
				setDraft((prev) => {
					const base = (prev ?? value).profile;
					if (base[key].includes(tag)) return prev;
					return cloneConfig({
						...prev ?? value,
						profile: {
							...base,
							[key]: [...base[key], tag]
						}
					});
				});
			};
			const removeProfileTag = (key, index) => {
				setDraft((prev) => {
					const base = (prev ?? value).profile;
					return cloneConfig({
						...prev ?? value,
						profile: {
							...base,
							[key]: base[key].filter((_, i) => i !== index)
						}
					});
				});
			};
			const patchResumePath = (s) => {
				setDraft((prev) => cloneConfig({
					...prev ?? value,
					resumePath: s
				}));
			};
			const patchSpecialUrl = (s) => {
				setDraft((prev) => {
					if ((prev ?? value).specialUrl === s) return prev;
					return cloneConfig({
						...prev ?? value,
						specialUrl: s
					});
				});
			};
			const patchDomains = (tag) => {
				setDraft((prev) => {
					const base = (prev ?? value).collection;
					if (base.allowedDomains.includes(tag)) return prev;
					return cloneConfig({
						...prev ?? value,
						collection: {
							...base,
							allowedDomains: [...base.allowedDomains, tag]
						}
					});
				});
			};
			const removeDomain = (index) => {
				setDraft((prev) => {
					const base = (prev ?? value).collection;
					return cloneConfig({
						...prev ?? value,
						collection: {
							...base,
							allowedDomains: base.allowedDomains.filter((_, i) => i !== index)
						}
					});
				});
			};
			const patchCollectionNumber = (key, n) => {
				setDraft((prev) => {
					const base = (prev ?? value).collection;
					if (base[key] === n) return prev;
					return cloneConfig({
						...prev ?? value,
						collection: {
							...base,
							[key]: n
						}
					});
				});
			};
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				style: pageStyle,
				children: [
					writeRefused && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						style: warnStyle,
						children: "保存的值被拒绝或已回退（可能超出红线范围或格式不合法），请修正后重试。"
					}),
					!writable && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						style: warnStyle,
						children: "设置当前只读：文档不接受写入（非本机页面为 memory 模式，或 Host 拒绝写入）。以下取值仅供参考。"
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						style: mutedStyle,
						children: "保存后对下一次工具运行生效（host 实时读取配置，无需重启服务）。"
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)(Section, {
						title: "求职画像",
						overridden: isOverridden(user, "profile"),
						dirty: isDirty("profile"),
						busy: busy === "profile",
						writable,
						onSave: () => {
							doSave("profile");
						},
						onReset: () => {
							doReset("profile");
						},
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(TagList, {
								label: "求职方向",
								tags: shown.profile.directions,
								disabled: !writable,
								onAdd: (t) => patchProfileList("directions", t),
								onRemove: (i) => removeProfileTag("directions", i)
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(TagList, {
								label: "目标城市",
								tags: shown.profile.cities,
								disabled: !writable,
								onAdd: (t) => patchProfileList("cities", t),
								onRemove: (i) => removeProfileTag("cities", i)
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(TagList, {
								label: "目标公司",
								tags: shown.profile.targetCompanies,
								disabled: !writable,
								onAdd: (t) => patchProfileList("targetCompanies", t),
								onRemove: (i) => removeProfileTag("targetCompanies", i)
							})
						]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Section, {
						title: "简历路径",
						overridden: isOverridden(user, "resumePath"),
						dirty: isDirty("resumePath"),
						busy: busy === "resumePath",
						writable,
						onSave: () => {
							doSave("resumePath");
						},
						onReset: () => {
							doReset("resumePath");
						},
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							style: fieldStyle,
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
									style: labelStyle,
									children: "简历文件路径"
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
									style: hintTextStyle,
									children: "本地文件路径，留空 = 未设置。求职画像只存设置分节（无 workspace 副本），经 campus_job_search 工具返回的画像行直供模型。"
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
									style: inputStyle,
									type: "text",
									value: shown.resumePath,
									disabled: !writable,
									placeholder: "例如 D:\\cv\\me.md",
									onChange: (e) => patchResumePath(e.target.value)
								})
							]
						})
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Section, {
						title: "专场入口",
						overridden: isOverridden(user, "specialUrl"),
						dirty: isDirty("specialUrl"),
						busy: busy === "specialUrl",
						writable,
						onSave: () => {
							doSave("specialUrl");
						},
						onReset: () => {
							doReset("specialUrl");
						},
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(SpecialUrlField, {
							label: "牛客秋招专场页 URL",
							value: shown.specialUrl,
							hint: "牛客秋招专场页地址（备用路线直开入口）；届次切换 / 专场改版时在此修改，无需改 skill。须为 http(s) URL，默认 27 届 2027QZzc 专场。",
							disabled: !writable,
							onChange: patchSpecialUrl
						})
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)(Section, {
						title: "采集",
						overridden: isOverridden(user, "collection"),
						dirty: isDirty("collection"),
						busy: busy === "collection",
						writable,
						onSave: () => {
							doSave("collection");
						},
						onReset: () => {
							doReset("collection");
						},
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(TagList, {
								label: "域名白名单",
								hint: "仅采集白名单内域名（host 后缀匹配）；白名单外一律拒绝。",
								tags: shown.collection.allowedDomains,
								disabled: !writable,
								onAdd: patchDomains,
								onRemove: removeDomain
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(NumberField, {
								label: "单次采集条数上限",
								value: shown.collection.maxItemsPerRun,
								min: 1,
								max: 50,
								hint: "红线：1–50，只收紧不放松（越界值保存时被拒绝）。",
								disabled: !writable,
								onChange: (n) => patchCollectionNumber("maxItemsPerRun", n)
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(NumberField, {
								label: "页面导航最小间隔",
								value: shown.collection.minIntervalMs,
								min: 1e3,
								max: 6e5,
								hint: "毫秒；红线：1000–600000，只收紧不放松。",
								disabled: !writable,
								onChange: (n) => patchCollectionNumber("minIntervalMs", n)
							})
						]
					})
				]
			});
		}
		/** 一个设置分组：标题 + 覆盖徽章 + 表单体 + 保存 / 恢复默认。 */
		function Section(props) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
				style: sectionStyle,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						style: sectionHeaderStyle,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							style: sectionTitleStyle,
							children: props.title
						}), props.overridden && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							style: overrideBadgeStyle,
							children: "已自定义"
						})]
					}),
					props.children,
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						style: sectionFootStyle,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							style: btnStyle(props.dirty && props.writable),
							disabled: !props.dirty || !props.writable || props.busy,
							onClick: props.onSave,
							children: props.busy ? "保存中…" : "保存"
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							style: btnStyle(props.writable),
							disabled: !props.writable || props.busy,
							onClick: props.onReset,
							children: "恢复默认"
						})]
					})
				]
			});
		}
		/** tags 编辑器：chips（点 × 删）+ 输入框（Enter 加）。 */
		function TagList(props) {
			const [text, setText] = (0, react.useState)("");
			const commit = () => {
				const t = text.trim();
				if (t === "") return;
				if (!props.tags.includes(t)) props.onAdd(t);
				setText("");
			};
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				style: fieldStyle,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						style: labelStyle,
						children: props.label
					}),
					props.hint !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						style: hintTextStyle,
						children: props.hint
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						style: chipRowStyle,
						children: [props.tags.map((tag, i) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
							style: chipStyle,
							children: [tag, !props.disabled && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								style: chipXStyle,
								onClick: () => props.onRemove(i),
								"aria-label": `移除 ${tag}`,
								children: "×"
							})]
						}, `${tag}#${i}`)), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
							style: inputStyle,
							value: text,
							disabled: props.disabled,
							placeholder: "输入后按回车添加",
							onChange: (e) => setText(e.target.value),
							onKeyDown: (e) => {
								if (e.key === "Enter") {
									e.preventDefault();
									commit();
								}
							}
						})]
					})
				]
			});
		}
		/** number 字段：本地 text + 失焦/回车提交（越界不 clamp——由服务端 schema 拒绝并提示）。 */
		function NumberField(props) {
			const [text, setText] = (0, react.useState)(String(props.value));
			(0, react.useEffect)(() => {
				setText(String(props.value));
			}, [props.value]);
			const commit = () => {
				const n = Number(text);
				if (!Number.isFinite(n)) return;
				props.onChange(n);
			};
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				style: fieldStyle,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						style: labelStyle,
						children: props.label
					}),
					props.hint !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						style: hintTextStyle,
						children: props.hint
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						style: numberRowStyle,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
							style: numberInputStyle,
							type: "number",
							min: props.min,
							max: props.max,
							step: 1,
							value: text,
							disabled: props.disabled,
							onChange: (e) => setText(e.target.value),
							onBlur: () => commit(),
							onKeyDown: (e) => {
								if (e.key === "Enter") {
									e.preventDefault();
									commit();
								}
							}
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
							style: hintTextStyle,
							children: [
								props.min,
								"–",
								props.max
							]
						})]
					})
				]
			});
		}
		/** text 字段：本地 text + 失焦/回车提交（不做本地格式拦截——非法值由
		* 服务端 schema 拒绝并提示，v0.1.1）。 */
		function SpecialUrlField(props) {
			const [text, setText] = (0, react.useState)(props.value);
			(0, react.useEffect)(() => {
				setText(props.value);
			}, [props.value]);
			const commit = () => {
				props.onChange(text);
			};
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				style: fieldStyle,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						style: labelStyle,
						children: props.label
					}),
					props.hint !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						style: hintTextStyle,
						children: props.hint
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
						style: inputStyle,
						type: "text",
						value: text,
						disabled: props.disabled,
						onChange: (e) => setText(e.target.value),
						onBlur: () => commit(),
						onKeyDown: (e) => {
							if (e.key === "Enter") {
								e.preventDefault();
								commit();
							}
						}
					})
				]
			});
		}
		//#endregion
		//#region src/ns.ts
		/**
		* dsh-campus-hunt — settings namespace 身份常量（v0.1.4）。
		*
		* 纯常量文件（零 import）：host 半场（config.ts re-export，供 entry /
		* 活重读 / 测试）与 client 半场（设置页卡片的 scope 绑定与 slot id）
		* 共用同一个 namespace 字符串。client 半场不能 value-import config.ts——
		* 该模块的运行时依赖（schemastery / data/store.ts 的 node: 内建）会被
		* client bundle 内联（tsdown.config.ts 的 alwaysBundle 策略），破坏浏览器
		* 构建。
		*/
		/**
		* Settings namespace（v0.1.4：0.1.7 自动 namespace 口径——ns = entry id
		* 'dsh-campus-hunt'，与 cordis.patch.yml 的 entry id 同值；client 卡片 slot id
		* 同值）。
		*/
		const NS = "dsh-campus-hunt";
		//#endregion
		//#region src/client/index.tsx
		const tailWrapStyle = {
			display: "flex",
			flexDirection: "column",
			gap: 10
		};
		const tailCrashStyle = {
			border: "1px solid rgba(255,255,255,0.14)",
			borderRadius: 8,
			padding: "10px 12px",
			fontSize: 12,
			color: "#d15454"
		};
		/**
		* turn-tail 卡片：从 owner 的 turn 位置读 'campus-cards' 数据（wire 不可信：
		* 非对象 / cards 非数组按无处理），逐项渲染 JobCards（组件本体零改动：
		* parseCard 分支 / 三 tab / 逐项校验 / GenericRow / CrashRow 全部复用）。
		* 永不白屏：数据缺席 / cards 空 → 渲染 null（不产出条目）；单项数据畸形或
		* 渲染 throw → 该项兜底最小 generic 行（JobCards 自带 try/catch，本层是
		* 外层防御——单项崩溃不连坐整列）。
		*/
		function CampusTail(props) {
			const raw = props.turn?.data?.get("campus-cards");
			const record = raw !== null && typeof raw === "object" && !Array.isArray(raw) ? raw : null;
			const cards = record !== null && Array.isArray(record.cards) ? record.cards : null;
			if (cards === null || cards.length === 0) return null;
			const openFile = props.openFile ?? (() => {});
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				style: tailWrapStyle,
				children: cards.map((card, index) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(CardItem, {
					card,
					sendPrompt: props.sendPrompt,
					loadWorkspaceFile: props.loadWorkspaceFile,
					openFile
				}, `${card?.callId ?? "unknown"}#${index}`))
			});
		}
		/** 单项卡片：JobCards 原样透传 + 外层 try/catch 兜底（永不白屏）。 */
		function CardItem(props) {
			try {
				const card = props.card;
				if (card === null || card === void 0) throw new Error("卡片数据缺失");
				return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(JobCards, {
					callId: card.callId,
					toolName: card.tool,
					block: card.block,
					openFile: props.openFile,
					sendPrompt: props.sendPrompt,
					loadWorkspaceFile: props.loadWorkspaceFile
				});
			} catch (error) {
				return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(CrashFallback, {
					toolName: props.card?.tool ?? "unknown",
					error
				});
			}
		}
		/** 单项崩溃兜底：最小 generic 行（外层防御；JobCards 内部已有同款 catch）。 */
		function CrashFallback(props) {
			const msg = props.error instanceof Error ? props.error.message : String(props.error);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				style: tailCrashStyle,
				children: [
					"卡片渲染失败（",
					props.toolName,
					"）：",
					msg
				]
			});
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
		const inject = [
			"slots",
			"sessions",
			"configForms",
			"remote",
			"remote.workspaceFiles",
			"uiConversation"
		];
		function apply(ctx) {
			const slots = ctx.slots;
			if (slots === void 0) return;
			const sessions = ctx.get?.("sessions") ?? void 0;
			/** 构造一个 session-scope inject 面：闭包捕获框架解析的 sessionId（单参形态）。 */
			const injectFace = (sessionId) => ({
				sendPrompt(text) {
					const face = sessions?.binding(sessionId)?.session;
					if (face === void 0) return;
					Promise.resolve().then(() => face.prompt([{
						type: "text",
						text
					}], "queue")).catch(() => {});
				},
				async loadWorkspaceFile(path) {
					const ns = (ctx.get?.("remote") ?? void 0)?.workspaceFiles;
					if (ns === void 0) return null;
					try {
						const res = await ns.readBytes(sessionId, path, {});
						if (res.ok !== true) return null;
						return new TextDecoder("utf-8").decode(res.value.data);
					} catch {
						return null;
					}
				}
			});
			const uiConversation = ctx.uiConversation;
			if (uiConversation !== void 0) {
				uiConversation.events.register(campusCardsDefinition);
				uiConversation.events.register(campusCardsPtcDefinition);
			}
			slots.inject("conversation.chat.turnTail", () => slots.register({
				name: "conversation.chat.turnTail",
				id: "campus-cards",
				inject: injectFace
			}, CampusTail));
			const configForms = ctx.configForms;
			if (configForms === void 0) return;
			const form = configForms.get(NS);
			/**
			* 保存一个顶层字段：form.set 的薄封装——true = Host 接受；false = 拒绝
			* 或跳写（form 已做 latest-write 镜像恢复，调用方直接以返回布尔 + 下一
			* 轮 snapshot 为准）；transport 失败 reject → 归一为 false（按钮可重试）。
			*/
			const setField = async (field, value) => {
				try {
					return await form.set(field, value);
				} catch {
					return false;
				}
			};
			/** 恢复默认一个顶层字段：form.unset 的薄封装（清 user 层回 base 继承）；
			* false / reject 口径同 setField。 */
			const resetField = async (field) => {
				try {
					return await form.unset(field);
				} catch {
					return false;
				}
			};
			/** root-scope inject 面（零参工厂）：裸 observable form + 写薄封装。 */
			const sectionInject = () => ({
				hooks: { form },
				setField,
				resetField
			});
			ctx.effect(() => configForms.whileServed([NS], () => slots.inject("settings.section", () => slots.register({
				name: "settings.section",
				id: NS,
				order: 50,
				label: () => "校招求职",
				inject: sectionInject
			}, CampusHuntSection))));
		}
		//#endregion
		exports.CampusTail = CampusTail;
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map