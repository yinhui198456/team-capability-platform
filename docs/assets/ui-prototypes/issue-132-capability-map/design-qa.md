# Issue #132 · 阶段 1 修订版高保真交互原型 Design QA（阶段 2 评审包）

## 本轮浏览器渲染证据

- **Shell source：** `qa/reference-m02-shell-1440x900.png`、`qa/reference-m03-shell-1440x900.png`（既有编译 viewer 渲染）；**content source：** `frontend/tests/e2e/visual/capability-map.spec.ts-snapshots/capability-map-1440x900-chromium-linux.png`。
- **Implementation：** `qa/prototype-review-package-1440x900.png`、`qa/prototype-member-1440x900.png`、`qa/prototype-leader-1440x900.png`、`qa/prototype-sticky-member-1440x900.png`、`qa/prototype-leader-edit-1440x900.png`、`qa/prototype-leader-save-1440x900.png`，DPR 1、CSS 1440×900。
- **同画布比较：** `qa/compare-shell-m02-m03-cm01-1440.png`（M02/M03 shell 与 CM01）、`qa/compare-full-default-1440.png` / `qa/compare-focused-header-tabs-1440.png`（能力地图内容）。已打开并人工检查这些渲染图，而不是从代码或独立截图推断。
- 这些是静态原型的浏览器渲染与交互验证，不是 UAT、用户验收或产品实现验收。

## 阶段 2 评审包结论

- M02/M03 的深蓝顶栏、年度/姓名/退出、浅色工作区和紧凑左侧信息架构被复用；CM01 有意不显示“数据范围”。Member 与 Leader 侧栏遵循 `Layout.tsx` 的可见项规则。
- 唯一 sticky 表面是 L1 Tab；白底和轻微阴影保证滚动时可辨识，深链/键盘目标未被遮挡。1440/1920/1024/768 的渲染检查均无页面横向溢出。
- Leader 的标准版本维护入口、L1/L2/L3 编辑、标签化输入、启用状态、取消/保存、成功反馈和单独的 L3 查看 Drawer 都已渲染并交互验证。保存明确标注为仅原型会话，不暗示后端持久化。
- 字体/层级、间距、颜色 token、无图像资产、真实能力地图文案、可见焦点、键盘和 reduced motion 均与既有约束一致。无 P0/P1/P2。

## 比较对象

- **Source visual truth**
  - `frontend/tests/e2e/visual/capability-map.spec.ts-snapshots/capability-map-1440x900-chromium-linux.png`
  - `frontend/tests/e2e/visual/capability-map.spec.ts-snapshots/capability-map-1920x1080-chromium-linux.png`
  - 交互规格：`docs/04_UI.md` §4.6 与 `requirements.md`
- **Rendered implementation**
  - `qa/prototype-default-1440x900.png`
  - `qa/prototype-selected-P02.02.08-1440x900.png`
  - `qa/prototype-search-keyboard-1440x900.png`
  - `qa/prototype-l2-P5-requirement-1440x900.png`
  - `qa/prototype-invalid-P02-1440x900.png`
  - `qa/prototype-default-1920x1080.png`
  - `qa/prototype-default-1024x768.png`
  - `qa/prototype-default-768x1024.png`

## 视口与归一化

| 状态 | CSS 视口 | Source pixels | Implementation pixels | DPR / 归一化 |
|---|---:|---:|---:|---|
| 默认能力地图 | 1440×900 | 1440×1153 | 1440×1183 | DPR 1；同宽 1:1，全页高度按真实内容 |
| 默认能力地图 | 1920×1080 | 1920×1153 | 1920×1183 | DPR 1；同宽 1:1 |
| 响应式 | 1024×768 | 不适用 | 1024×1260 | DPR 1；结构/溢出检查 |
| 响应式 | 768×1024 | 不适用 | 768×1438 | DPR 1；结构/溢出检查 |

全景并排证据为 `qa/compare-full-default-1440.png`；页头、搜索、Tab、概述和首组能力标准的聚焦比较为 `qa/compare-focused-header-tabs-1440.png`。两图将 source 与 implementation 放在同一像素画布中，不以分开查看冒充并排比较。

## Required fidelity surfaces

- **Fonts / typography：** 沿用 TCP 的 Inter/system/Segoe UI 字体链、28px 页面标题、12–14px 工具文案与现有字重层级；中英文混排、编号和长名称无截断或严重碎裂。
- **Spacing / layout rhythm：** 保留 224px 侧栏、24px 工作区、紧凑页头、横向 L1 Tab、左蓝线概述和密集 L2 行；1440 首屏可识别至少四个 L2，1920 没有简单放大空白。
- **Colors / tokens：** 复用 TCP 深蓝顶栏、`#175cd3` 选择色、浅蓝选择面、白色内容面与灰色层级；错误态使用独立红色语义，不靠颜色单独传递信息。
- **Image quality / assets：** 源视觉不包含产品图片或插画，本原型也不伪造媒体、图标或占位资源；该项无缺失资产。
- **Copy / content：** 使用能力地图正式语义：L1 能力域、L2 能力标准/职级要求、L3 达成路径/学习实践项；P5 完整要求比按钮摘要提供更多可验收信息，不再原样重复。
- **States / interactions：** 已覆盖默认、L1/L2/L3 选中、搜索打开/空态/清除、键盘活动项、L2 P4–P8、L3 Drawer、可识别与不可识别无效深链、空 L2。
- **Accessibility：** 原生按钮/input/nav；combobox/listbox/option、tablist/tab、dialog、alert/live region；可见焦点；Drawer Escape 与焦点返回；skip link；reduced motion。
- **Responsiveness：** 1440、1920、1024、768 均为零页面级横向溢出；窄视口隐藏非核心侧栏、页头与搜索纵向排列、L1 Tab 可横向滚动、等级要求改单列。

## 浏览器交互证据

`qa/verify.py` 使用 Playwright Chromium、DPR 1 执行并通过：

- L1、L2、L3 选择分别写入 `#P02`、`#P02.02`、`#P02.02.08`；
- 刷新恢复 P02 → P02.02 → P02.02.08；
- 后退/前进恢复页面、展开与 URL；
- 同页 Hash 变化无需刷新即可同步；
- 搜索支持 ArrowUp/ArrowDown、Home/End、Enter、Escape；
- 清除搜索不改变已选路径；
- `#P02.02.99` 保留 P02 上下文并显式报错，`#NOT-A-CODE` 不冒充 P01；
- L2 摘要与完整要求不重复；
- Drawer Escape 关闭并将焦点返回 L3；
- 四个视口均无横向溢出；
- console error 0，page error 0。

## 比较历史

### Pass 1

- **[P2] 页面内“当前路径”标签偏离视觉源。** 已删除，URL 状态仅由浏览器地址栏和无障碍 live message 表达。
- **[P2] 默认域列表数量低于正式基线。** 已补齐 P01/P02 的十个 L2 入口，恢复首屏与全页信息密度。
- **[P3] full-page capture 中 skip link 出现拼接伪影。** 已将隐藏定位从 transform 改为负 top；键盘功能不变，复验截图无伪影。

### Pass 2

- 全景和聚焦并排比较未发现可执行的 P0/P1/P2 视觉差异。
- 交互、响应式、控制台和溢出复验全部通过。

## Findings

无未解决的 P0/P1/P2。

## Follow-up polish

- P3：展开/收起使用文字按钮而非源基线的单字符加减号。这是有意的自包含无障碍选择；若阶段 2 用户评审要求逐像素贴近，可在产品实现中复用项目已安装的统一图标组件，同时保留可访问名称。

final result: passed
