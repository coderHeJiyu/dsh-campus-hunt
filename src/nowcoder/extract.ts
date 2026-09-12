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
export const EXTRACT_LIST_EXPRESSION = `(() => {
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
})()`

/** 列表页 ego_js 执行后点击「秋招正式批」tab：返回 'ok' 或 'tab not found'。 */
export const CLICK_ACTIVITY_TAB_EXPRESSION = `(() => {
  var tab = Array.from(document.querySelectorAll("ul.category-list li")).find(function (li) {
    return String(li.textContent || "").trim() === "27届秋招正式批";
  });
  if (!tab) return "tab not found";
  tab.click();
  return "ok";
})()`

/**
 * 列表页（已切「秋招正式批」tab）ego_js 执行后读取总览卡
 * div.activity-info 内「查看详情」a.detail 的 href，去 query 规范化：
 * 返回专场页 URL（如 https://www.nowcoder.com/jobs/activity/v2/special-activity/index/2027QZzc），
 * 或 'detail link not found'。
 */
export const GET_ACTIVITY_DETAIL_HREF_EXPRESSION = `(() => {
  var scope = document.querySelector(".activity-info") || document;
  var hit = Array.from(scope.querySelectorAll("a")).find(function (a) {
    return String(a.textContent || "").trim() === "查看详情"
      && String(a.getAttribute("href") || "").indexOf("special-activity") !== -1;
  });
  if (!hit) return "detail link not found";
  return String(hit.getAttribute("href") || "").split("?")[0];
})()`

/** 专场页 ego_js 执行后点击「热招职位」区块：返回 'ok' 或 'hot tab not found'。 */
export const CLICK_HOT_TAB_EXPRESSION = `(() => {
  var tab = Array.from(document.querySelectorAll("div.tab-bar span[data-tab]")).find(function (sp) {
    return String(sp.textContent || "").indexOf("热招职位") !== -1;
  });
  if (!tab) return "hot tab not found";
  tab.click();
  return "ok";
})()`

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
export const EXTRACT_JD_EXPRESSION = `(() => {
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
})()`

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
export const EXTRACT_SCHEDULE_EXPRESSION = `(() => {
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
})()`
