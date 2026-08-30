const ratings = [
  [0, "未接触"],
  [1, "入门"],
  [2, "基础"],
  [3, "熟练"],
  [4, "精通"],
  [5, "专家"],
];

const capabilities = [
  {
    code: "C01.01.01",
    name: "常用办公工具基础",
    rating: 2,
    target: 2,
    level: "P4 标准",
  },
  {
    code: "C01.01.02",
    name: "文件命名与目录结构规范",
    rating: 1,
    target: 2,
    level: "P4 标准",
    selected: true,
    priority: "高",
    month: "2026-05",
  },
  {
    code: "C01.01.03",
    name: "文件版本管理与变更记录",
    rating: 0,
    target: 2,
    level: "P4 标准",
  },
  {
    code: "C01.01.04",
    name: "PDF、截图与附件整理",
    rating: 3,
    target: 3,
    level: "P5 标准",
  },
  {
    code: "C01.01.05",
    name: "项目资料归档与可追溯管理",
    rating: 2,
    target: 3,
    level: "P5 标准",
  },
];

const state = {
  items: capabilities.map((item) => ({ ...item })),
  ratingSaved: true,
  message: null,
};

const layout = document.body.dataset.layout;
const layoutNames = {
  inline: "方案 1 · 行内展开",
  stacked: "方案 2 · 上下工作区",
  side: "方案 3 · 左右工作台",
};

function gapOf(item) {
  return Math.max(0, item.target - item.rating);
}

function ratingControl(item) {
  return `<div class="rating compact-rating" role="radiogroup" aria-label="${item.name} 当前评级">
    ${ratings
      .map(
        ([
          value,
          label,
        ]) => `<button type="button" role="radio" aria-checked="${item.rating === value}" class="${item.rating === value ? "active" : ""}" data-action="rate" data-code="${item.code}" data-rating="${value}">
          <b>${value}</b><small>${label}</small>
        </button>`,
      )
      .join("")}
  </div>`;
}

function planButton(item) {
  const gap = gapOf(item);
  if (!gap) return `<span class="no-plan">无需提升</span>`;
  return `<button type="button" class="btn plan-toggle ${item.selected ? "success-soft" : ""}" data-action="toggle-plan" data-code="${item.code}">${item.selected ? "已加入" : "加入提升计划"}</button>`;
}

function planFields(item, mode = "row") {
  const monthOptions = [
    "",
    "2026-05",
    "2026-06",
    "2026-07",
    "2026-08",
    "2026-09",
  ];
  return `<div class="plan-fields ${mode}" data-plan-code="${item.code}">
    <div class="plan-identity"><b>${item.name}</b><small>${item.code} · Gap ${gapOf(item)}</small></div>
    <label>优先级
      <select data-action="priority" data-code="${item.code}">
        ${["高", "中", "低"].map((value) => `<option ${item.priority === value ? "selected" : ""}>${value}</option>`).join("")}
      </select>
    </label>
    <label class="month-label">计划月份 <span aria-hidden="true">*</span>
      <select data-action="month" data-code="${item.code}">
        ${monthOptions.map((value) => `<option value="${value}" ${item.month === value ? "selected" : ""}>${value ? value.replace("-", " 年 ") + " 月" : "待补计划月份"}</option>`).join("")}
      </select>
      ${item.month ? "" : '<small class="field-error">请选择计划月份</small>'}
    </label>
    <span class="saved-state" role="status">${item.month ? "已保存" : "待补月份"}</span>
    <button type="button" class="text-action danger-text" data-action="remove" data-code="${item.code}">移出计划</button>
  </div>`;
}

function capabilityRow(item, withInlineEditor = false) {
  return `<article class="capability-row ${item.selected ? "selected" : ""}" id="cap-${item.code}">
    <div class="capability-name"><b>${item.name}</b><small>${item.code} · 当前职级必备</small></div>
    ${ratingControl(item)}
    <div class="target-gap"><b>目标：${item.target} · ${item.level}</b><span>Gap：${gapOf(item)}</span></div>
    <div class="plan-action">${planButton(item)}</div>
    ${withInlineEditor && item.selected ? planFields(item, "inline-editor") : ""}
  </article>`;
}

function tableHeader() {
  return `<div class="capability-head"><span>能力项</span><span>当前评级</span><span>目标与差距</span><span>提升计划</span></div>`;
}

function selectedItems() {
  return state.items.filter((item) => item.selected);
}

function statusBlock() {
  if (!state.message) return "";
  return `<div class="feedback ${state.message.type}" role="status" tabindex="-1"><b>${state.message.title}</b><span>${state.message.detail}</span></div>`;
}

function actionSummary(includeSave = true) {
  const selected = selectedItems();
  const missing = selected.filter((item) => !item.month).length;
  return `<div class="action-summary">
    <div><b>计划草稿：已选 ${selected.length} 项</b><span>${missing ? `待补月份 ${missing} 项` : "计划月份已完整"}</span></div>
    <div class="action-buttons">
      ${includeSave ? '<button type="button" class="btn" data-action="save-ratings">保存能力评级</button>' : ""}
      <button type="button" class="btn primary" data-action="generate">生成所选学习任务</button>
    </div>
  </div>`;
}

function filters() {
  return `<div class="domain-bar">
    <div class="domain-tabs" role="tablist" aria-label="能力域">
      <button class="active" role="tab" aria-selected="true">全部能力域</button>
      <button role="tab">C01 · 基本办公能力 <small>30/30</small></button>
      <button role="tab">C02 · 沟通协作 <small>28/28</small></button>
      <button role="tab">C03 · 学习创新 <small>28/28</small></button>
      <button role="tab">P01 · 数据基础设施 <small>61/61</small></button>
    </div>
    <label class="search-box"><span>搜索</span><input type="search" placeholder="搜索能力项" /></label>
  </div>`;
}

function inlineLayout() {
  return `<section class="capability-panel inline-layout">
    <header class="group-heading"><div><b>C01.01 · 办公工具与文件管理基础</b><span>5 条达成路径</span></div><strong>5/5</strong></header>
    ${tableHeader()}
    ${state.items.map((item) => capabilityRow(item, true)).join("")}
  </section>
  ${statusBlock()}
  <div class="sticky-actions">${actionSummary()}</div>`;
}

function stackedLayout() {
  const selected = selectedItems();
  return `<section class="capability-panel rating-zone">
    <header class="zone-heading"><div><span>评级区</span><h2>逐项完成当前评级</h2><p>可以分批保存；保存评级不会生成任务。</p></div><span class="saved-state">${state.ratingSaved ? "评级已保存" : "评级有未保存修改"}</span></header>
    ${tableHeader()}
    ${state.items
      .slice(0, 3)
      .map((item) => capabilityRow(item))
      .join("")}
    <footer class="zone-footer"><button type="button" class="btn" data-action="save-ratings">保存本页评级</button></footer>
  </section>
  <div class="flow-connector" aria-hidden="true"><span></span><b>已加入的能力在下方集中维护</b><span></span></div>
  <section class="capability-panel draft-zone">
    <header class="zone-heading"><div><span>计划区</span><h2>提升计划草稿（${selected.length}）</h2><p>补齐每个已选能力的优先级与计划月份，再显式生成任务。</p></div></header>
    <div class="draft-list">${selected.length ? selected.map((item) => planFields(item, "draft-row")).join("") : '<div class="empty-state">尚未加入提升计划，请先在上方选择有 Gap 的能力项。</div>'}</div>
    ${statusBlock()}
    ${actionSummary(false)}
  </section>`;
}

function sideLayout() {
  const selected = selectedItems();
  return `<div class="side-layout">
    <section class="capability-panel side-rating-zone">
      ${tableHeader()}
      ${state.items.map((item) => capabilityRow(item)).join("")}
    </section>
    <aside class="plan-workbench" aria-labelledby="workbench-title">
      <header><div><span>计划区</span><h2 id="workbench-title">提升计划草稿</h2></div><strong>${selected.length}</strong></header>
      <div class="workbench-list">${selected.length ? selected.map((item) => planFields(item, "workbench-card")).join("") : '<div class="empty-state">从左侧加入有 Gap 的能力项。</div>'}</div>
      ${statusBlock()}
      <p class="helper-copy">保存评级不会生成任务。</p>
      ${actionSummary()}
    </aside>
  </div>`;
}

function shell(content) {
  return `<div class="prototype-lab selected-mode issue-201-prototype">
    <div class="labbar">
      <a class="lab-home" href="../index.html"><span class="lab-home-full">阶段 1 方案索引</span><span class="lab-home-short">方案索引</span></a>
      <div class="lab-page"><span>M02 · 能力评级与提升计划</span><strong>${layoutNames[layout]}</strong></div>
      <nav class="option-switch" aria-label="切换原型方案">
        <a class="${layout === "inline" ? "active" : ""}" href="01-inline-expand.html">方案 1</a>
        <a class="${layout === "stacked" ? "active" : ""}" href="02-stacked-zones.html">方案 2</a>
        <a class="${layout === "side" ? "active" : ""}" href="03-side-workbench.html">方案 3</a>
      </nav>
    </div>
    <div class="product-shell">
      <header class="product-top"><b>Team Capability Platform</b><div><button type="button">2026 年</button><span>数据范围：本人</span><strong>Member User</strong><button type="button">退出</button></div></header>
      <aside class="product-nav"><nav><b>我的成长</b><button type="button">我的工作台</button><button type="button" class="active">能力评级与提升计划</button><button type="button">年度成长计划</button><button type="button">学习任务</button><button type="button">学习任务详情</button></nav><div class="nav-foot">TCP 学习环境</div></aside>
      <main class="page-canvas">
        <div class="page-intro"><div><span>能力成长</span><h1>能力评级与提升计划</h1><p>逐项完成评级，再为有差距的能力设置提升计划。</p></div><span class="autosave-state">计划草稿自动保存中</span></div>
        <div class="summary-strip"><span>能力域 <b>6</b></span><span>三级能力项 <b>238</b></span><span>已评级 <b>238</b></span><span>存在差距 <b>16</b></span><span>已加入计划 <b>${selectedItems().length}</b></span></div>
        ${filters()}
        ${content}
      </main>
      <footer class="product-foot"><span>当前原型：M02 · ${layoutNames[layout]}</span><span>计划周期：2026-07-01 至 2027-06-30</span></footer>
    </div>
  </div>`;
}

function render() {
  const content =
    layout === "inline"
      ? inlineLayout()
      : layout === "stacked"
        ? stackedLayout()
        : sideLayout();
  document.querySelector("#root").innerHTML = shell(content);
}

function findItem(code) {
  return state.items.find((item) => item.code === code);
}

document.addEventListener("click", (event) => {
  const target = event.target.closest("[data-action]");
  if (!target) return;
  const item = findItem(target.dataset.code);

  if (target.dataset.action === "rate" && item) {
    item.rating = Number(target.dataset.rating);
    if (!gapOf(item)) item.selected = false;
    state.ratingSaved = false;
    state.message = null;
  }
  if (target.dataset.action === "toggle-plan" && item) {
    item.selected = !item.selected;
    item.priority ||= "高";
    state.message = null;
  }
  if (target.dataset.action === "remove" && item) {
    item.selected = false;
    state.message = null;
  }
  if (target.dataset.action === "save-ratings") {
    state.ratingSaved = true;
    state.message = {
      type: "success",
      title: "能力评级已保存",
      detail: "保存评级不会生成学习任务。",
    };
  }
  if (target.dataset.action === "generate") {
    const selected = selectedItems();
    const missing = selected.find((entry) => !entry.month);
    state.message = !selected.length
      ? {
          type: "error",
          title: "暂时无法生成",
          detail: "请先加入至少一个有 Gap 的能力项。",
        }
      : missing
        ? {
            type: "error",
            title: "请补充计划月份",
            detail: `${missing.code} ${missing.name} 尚未填写计划月份，当前未生成任何任务。`,
          }
        : {
            type: "success",
            title: "已生成所选学习任务",
            detail: `本次创建 ${selected.length} 项；重复操作不会创建重复任务。`,
          };
  }
  render();
  if (target.dataset.action === "generate") {
    const feedback = document.querySelector(".feedback");
    feedback?.focus();
  }
});

document.addEventListener("change", (event) => {
  const target = event.target.closest("[data-action]");
  if (!target) return;
  const item = findItem(target.dataset.code);
  if (!item) return;
  if (target.dataset.action === "priority") item.priority = target.value;
  if (target.dataset.action === "month") item.month = target.value;
  state.message = null;
  render();
});

render();
