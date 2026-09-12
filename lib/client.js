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
		/** assistant/message 是否含非空文本（host turn-tail hasTextAssistant 同口径）。 */
		function messageHasText(event) {
			const message = asRecord$1(event.data)?.message;
			const content = asRecord$1(message)?.content;
			if (!Array.isArray(content)) return false;
			return content.some((block) => {
				const r = asRecord$1(block);
				return r !== null && r.type === "text" && typeof r.text === "string" && r.text.trim() !== "";
			});
		}
		/**
		* 锚定 seq（host turn-tail / turn-process 对齐）：有文本答案 S+0.075，
		* 否则 endSeq-0.05；回合未结束（endSeq undefined）→ null（buildViewNode
		* 不产出）。
		*/
		function cardAnchorSeq(state) {
			if (state.endSeq === void 0) return null;
			return state.textSeq !== void 0 ? state.textSeq + .075 : state.endSeq - .05;
		}
		const campusCardsDefinition = {
			kind: "campus-cards",
			target: "chat",
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
				if (event.type === "assistant/message") return event.surfaceOp === "append" && messageHasText(event) ? {
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
					textSeq: void 0,
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
				if (event.type === "assistant/message") return {
					...state,
					textSeq: event.seq
				};
				if (event.type === "turn/end") return {
					...state,
					endSeq: event.seq
				};
				return state;
			},
			publication: (match) => match.event.type === "turn/end" ? "immediate" : "none",
			buildViewNode: (context) => {
				const state = context.state;
				if (state === void 0) return null;
				const anchor = cardAnchorSeq(state);
				if (anchor === null || state.cards.length === 0) return null;
				return {
					key: context.key,
					kind: "campus-cards",
					id: context.id,
					target: "chat",
					anchorSeq: anchor,
					location: context.start?.location ?? { kind: "unresolved" },
					visibility: "visible",
					data: { cards: state.cards }
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
			const [activeTab, setActiveTab] = (0, react.useState)(0);
			const [selectedId, setSelectedId] = (0, react.useState)(null);
			const [localStatus, setLocalStatus] = (0, react.useState)({});
			const [expandedSections, setExpandedSections] = (0, react.useState)({});
			const parsed = parseCard(toolName, block);
			if (parsed === null) {
				if (!("kind" in block)) return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(RunningRow, {
					toolName,
					block
				});
				return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(GenericRow, {
					toolName,
					block
				});
			}
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
		//#region src/client/CampusCardsView.tsx
		const wrapStyle = {
			display: "flex",
			flexDirection: "column",
			gap: 10
		};
		const crashStyle = {
			border: "1px solid rgba(255,255,255,0.14)",
			borderRadius: 8,
			padding: "10px 12px",
			fontSize: 12,
			color: "#d15454"
		};
		function CampusCardsView(props) {
			const cards = props.node?.data?.cards;
			if (cards === void 0 || cards.length === 0) return null;
			const openFile = props.openFile ?? (() => {});
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				style: wrapStyle,
				children: cards.map((card, index) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(CardItem, {
					card,
					sendPrompt: props.sendPrompt,
					openFile,
					cwd: props.cwd
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
					cwd: props.cwd,
					sendPrompt: props.sendPrompt
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
				style: crashStyle,
				children: [
					"卡片渲染失败（",
					props.toolName,
					"）：",
					msg
				]
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
		* 设置页卡片（settings.section entry）。渲染只读 useScope selector；
		* 写经 setField / resetField 回调；draft 本地暂存。
		*/
		function CampusHuntSection(props) {
			const status = props.useScope((s) => s.status);
			const value = props.useScope((s) => s.value);
			const user = props.useScope((s) => s.user);
			const writable = props.useScope((s) => s.writable);
			const [draft, setDraft] = (0, react.useState)(null);
			const [busy, setBusy] = (0, react.useState)(null);
			const [outcome, setOutcome] = (0, react.useState)(null);
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
					children: "设置不可用：无法读取 Host 设置文档，或 campus-hunt 分节未注册。"
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
					children: "请重启 DSH 让 host 重新注册 campus-hunt 分节后重试。"
				})]
			});
			const shown = draft ?? value;
			const isDirty = (field) => draft !== null && !jsonEqual(draft[field], value[field]);
			/** 保存一个顶层字段：写后经 draft 归零回到最新快照；非 ok 显示提示。 */
			const doSave = async (field) => {
				if (draft === null || !isDirty(field)) return;
				setBusy(field);
				setOutcome(null);
				const r = await props.setField(field, draft[field]);
				setDraft(null);
				setBusy(null);
				if (r !== "ok") setOutcome(r);
			};
			/** 恢复默认一个顶层字段（unset，回 base 层）。 */
			const doReset = async (field) => {
				setBusy(field);
				setOutcome(null);
				const r = await props.resetField(field);
				setDraft(null);
				setBusy(null);
				if (r !== "ok") setOutcome(r);
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
					outcome !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						style: warnStyle,
						children: outcome === "stale" ? "已有更新，已刷新。请重新确认后再保存。" : outcome === "timeout" ? "保存超时（值可能已落盘），请重试。" : "保存的值被拒绝（可能超出红线范围或格式不合法），请修正后重试。"
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
		//#region src/client/index.tsx
		/**
		* client 半场注入声明：slots（卡片注册）+ sessions（动作 prompt 通道）
		* + settingsScope / remote（v0.1 设置页卡片，口径 8）+ uiConversation
		* （v0.1.1 回答区卡片的数据面注册）。
		* remote 必须声明（SA-c1 决策：ui-theme 先例——settings-scope 的失效转发
		* 订在消费 ctx 的 remote 上）；本插件代码不直接访问 remote。
		*/
		const inject = [
			"slots",
			"sessions",
			"settingsScope",
			"remote",
			"uiConversation"
		];
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
		const writeTimings = {
			write: 5e3,
			settle: 400
		};
		function apply(ctx) {
			const slots = ctx.slots;
			if (slots === void 0) return;
			const sessions = ctx.get?.("sessions") ?? void 0;
			/** 构造一个 session-scope inject 面：闭包捕获框架解析的 sessionId（单参形态）。 */
			const injectFace = (sessionId) => ({ sendPrompt(text) {
				const face = sessions?.binding(sessionId)?.session;
				if (face === void 0) return;
				Promise.resolve().then(() => face.prompt([{
					type: "text",
					text
				}], "queue")).catch(() => {});
			} });
			const uiConversation = ctx.uiConversation;
			if (uiConversation !== void 0) uiConversation.events.register(campusCardsDefinition);
			slots.inject("conversation.chat.node", () => slots.register({
				name: "conversation.chat.node",
				key: "campus-cards",
				inject: injectFace
			}, CampusCardsView));
			const settingsScope = ctx.settingsScope;
			if (settingsScope === void 0) return;
			const scope = settingsScope.bind({ namespace: NS });
			/** 读配置值的顶层字段（Config 无索引签名，经 unknown 中转）。 */
			const fieldOf = (cfg, field) => cfg !== void 0 ? cfg[field] : void 0;
			/**
			* 在途写计数（setField / resetField 已发起、未返回的数量；等待期间含
			* 自身）。>1 = 同批次还有其余写，本写 settle 不意味视图终态（fold 只随
			* 队列中最后一写的 settle 发生）→ 值条件等待；==1 = 仅本写，settle 后
			* 视图即终态 → 直接比对（快通道）。
			*/
			let inFlightWrites = 0;
			/**
			* wire 未 settle 的 op 计数（op resolve / reject 时经 op.then 递减，与
			* 本写是否还在等待无关）。视图终态 ⇔ 已观测 op 全部 wire settle：接受
			* 批次 fold 发生在末写 settle（harness settings-scope.ts mutate：仅
			* latest settle acceptView，且先于 Promise settle 完成）；拒绝批次只有
			* recover 读取、视图不再变。=0 即视图终态，可提前做最终比对（首轮观测
			* 仅标记稳定、次轮才提前判定——给末写 fold 的落地留一轮间隔，对齐
			* mock / 异步 fold 时序）。
			*/
			let pendingWireOps = 0;
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
			const waitForValue = (condition, deadlineMs) => new Promise((resolve) => {
				const terminal = () => pendingWireOps === 0;
				let done = false;
				let sawTerminal = terminal();
				let unsub;
				let poll;
				let timer;
				const finish = (r) => {
					if (done) return;
					done = true;
					if (unsub !== void 0) unsub();
					if (poll !== void 0) clearInterval(poll);
					if (timer !== void 0) clearTimeout(timer);
					resolve(r);
				};
				if (condition()) {
					finish("met");
					return;
				}
				unsub = scope.subscribe(() => {
					if (condition()) finish("met");
				});
				poll = setInterval(() => {
					if (condition()) finish("met");
					else if (sawTerminal && terminal()) finish("folded");
					else if (terminal()) sawTerminal = true;
				}, writeTimings.settle);
				timer = setTimeout(() => finish(terminal() ? "folded" : "pending"), deadlineMs);
			});
			/**
			* 写 op 竞速（v0.1 live 缺陷 B 修复）：'settled' = op 正常
			* resolve（wire 完成）；'rejected' = op reject（wire 带错完成）；
			* 'timeout' = 超过 writeTimings.write 仍未 settle（慢写通道不得让按钮
			* 永久卡「保存中…」）。前两者都意味 wire 已 settle（调用方以 op.then
			* 递减 pendingWireOps），只有 'timeout' 时 op 仍在 wire 上、视图还可能
			* 变。setField / resetField 两条路径都经本竞速（任何写路径按钮卡住不
			* 超过 write + 核验耗时）。
			*/
			const raceTimeout = (op) => new Promise((resolve) => {
				let timer;
				op.then(() => {
					if (timer !== void 0) clearTimeout(timer);
					resolve("settled");
				}, () => {
					if (timer !== void 0) clearTimeout(timer);
					resolve("rejected");
				});
				timer = setTimeout(() => resolve("timeout"), writeTimings.write);
			});
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
			const setField = async (field, value) => {
				const before = scope.getSnapshot();
				const beforeValue = fieldOf(before.value, field);
				inFlightWrites++;
				const op = scope.set(field, value);
				op.then(() => {
					pendingWireOps--;
				}, () => {
					pendingWireOps--;
				});
				pendingWireOps++;
				const isOk = () => jsonEqual(fieldOf(scope.getSnapshot().value, field), value);
				const verdict = () => {
					if (isOk()) return "ok";
					if (jsonEqual(fieldOf(scope.getSnapshot().value, field), beforeValue)) return "rejected";
					return "stale";
				};
				try {
					if (await raceTimeout(op) !== "settled") return isOk() ? "ok" : "timeout";
					if (inFlightWrites <= 1) return verdict();
					const w = await waitForValue(isOk, writeTimings.write);
					if (w === "met") return "ok";
					if (w === "pending") return "timeout";
					return verdict();
				} finally {
					inFlightWrites--;
				}
			};
			/**
			* 恢复默认一个顶层字段：unset 后值应回 base 层对应字段且 user 分节不再
			* 含该字段（存在性语义：值与 base 相等的覆盖也是覆盖）；base 缺席
			*（宿主未声明组合层）或 base 无对应字段时无法核验，宽限为 ok（服务端
			* 为事实源）。四态 / 超时 / 值条件等待语义与 setField 相同。
			*/
			const resetField = async (field) => {
				const before = scope.getSnapshot();
				const beforeValue = fieldOf(before.value, field);
				const base = before.base;
				const hasBase = base !== null && typeof base === "object" && !Array.isArray(base);
				const expected = hasBase ? base[field] : void 0;
				inFlightWrites++;
				const op = scope.unset(field);
				op.then(() => {
					pendingWireOps--;
				}, () => {
					pendingWireOps--;
				});
				pendingWireOps++;
				const isOk = () => {
					const snap = scope.getSnapshot();
					return jsonEqual(fieldOf(snap.value, field), expected) && !isOverridden(snap.user, field);
				};
				const verdict = () => {
					if (isOk()) return "ok";
					if (jsonEqual(fieldOf(scope.getSnapshot().value, field), beforeValue)) return "rejected";
					return "stale";
				};
				try {
					if (await raceTimeout(op) !== "settled") return isOk() ? "ok" : "timeout";
					if (!hasBase || expected === void 0) return "ok";
					if (inFlightWrites <= 1) return verdict();
					const w = await waitForValue(isOk, writeTimings.write);
					if (w === "met") return "ok";
					if (w === "pending") return "timeout";
					return verdict();
				} finally {
					inFlightWrites--;
				}
			};
			/** root-scope inject 面（零参工厂）：hooks.scope 裸 observable + 写回调。 */
			const sectionInject = () => ({
				hooks: { scope },
				setField,
				resetField
			});
			slots.inject("settings.section", () => slots.register({
				name: "settings.section",
				id: NS,
				order: 50,
				label: "校招求职",
				inject: sectionInject
			}, CampusHuntSection));
		}
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		exports.writeTimings = writeTimings;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map