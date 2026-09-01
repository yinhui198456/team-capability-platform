# TCP 页面资产索引（docs/assets/ui-prototypes）

本目录是 TCP 页面视觉与交互资产的唯一索引目录，包含两部分：

1. **既有视觉基线 PNG（历史确认稿）**：[UI-01-my-growth-dashboard.png](UI-01-my-growth-dashboard.png) ～ [UI-05-team-capability-analysis.png](UI-05-team-capability-analysis.png)，为早期迭代确认的静态视觉基线；页面规格冲突时以 `docs/04_UI.md` 页面规格为准。
2. **统一交互原型基线**：`prototype-v1/`，包含第一批页面的故事线、页面地图与可交互静态原型；M02 使用 Issue #201 已批准的方案 1 高保真实现。
3. **M02 历史证据与兼容入口**：[`issue-201-m02/`](issue-201-m02/) 保留截图和 QA 证据，旧 HTML 地址统一跳转到 `prototype-v1`，不再作为推荐入口。

页面矩阵（页面编号、角色、路由、故事节点、最终版本、master 落地状态、批次、Chrome 验收）的唯一权威位置在 [../../04_UI.md](../../04_UI.md)（§4.9）；业务规则唯一来源是 [../../01_Product.md](../../01_Product.md)（Issue #187 故事合同）。原型不定义任何 API、指标口径或数据库字段；`prototype-v1` 为纯静态 HTML/CSS/JS，不连接后端。

## prototype-v1 最终版本清单（第一批定版）

| 编号 | 页面 | 角色 | 最终版本 | 入口 |
|---|---|---|---|---|
| M01 | 我的工作台 | Member | V1 | [prototype-v1/pages/m01-selected.html](prototype-v1/pages/m01-selected.html) |
| M02 | 能力评级与提升计划 | Member | V1 | [prototype-v1/pages/m02-selected.html](prototype-v1/pages/m02-selected.html) |
| M03 | 年度成长计划 | Member | V1 | [prototype-v1/pages/m03-selected.html](prototype-v1/pages/m03-selected.html) |
| M04 | 学习任务 | Member | V1 | [prototype-v1/pages/m04-selected.html](prototype-v1/pages/m04-selected.html) |
| M05 | 学习任务详情 | Member | V1 | [prototype-v1/pages/m05-selected.html](prototype-v1/pages/m05-selected.html) |
| B01 | 成果验收 | Buddy | V2（仅 Evidence/成果验收，不恢复 Buddy 自评复核） | [prototype-v1/pages/b01-selected.html](prototype-v1/pages/b01-selected.html) |
| D01 | 成员学习进度看板 | Buddy / Leader | V3（统一为 V1/V2 浅色调；原型数字仅为候选指标，非业务口径） | [prototype-v1/pages/d01-selected.html](prototype-v1/pages/d01-selected.html) |
| L01 | 团队能力分析 | Leader | V1 | [prototype-v1/pages/l01-selected.html](prototype-v1/pages/l01-selected.html) |
| A01 | 用户、角色与辅导关系 | Admin | V1（含新增用户状态与用户等级设置） | [prototype-v1/pages/a01-selected.html](prototype-v1/pages/a01-selected.html) |

- **第二批**：M06 月度复盘、M07 成长档案，不在本轮。
- **不实施**：L02 年度能力重点，已移出实施范围。
- A01 新增用户流程辅助入口：[prototype-v1/pages/a01-create-user.html](prototype-v1/pages/a01-create-user.html)。

## 打开方式

- **定版候选索引（唯一推荐起点）**：[prototype-v1/index.html?collection=selected](prototype-v1/index.html?collection=selected)（或 [prototype-v1/selected.html](prototype-v1/selected.html) 自动跳转）。浏览器地址栏加 `&page=<编号>` 可直达指定页面；`&page=M02` 会进入独立高保真页面。
- **单页独立入口**：`prototype-v1/pages/<编号>-selected.html`；M02 是实际高保真实现，其余入口跳转到索引对应页。
- **故事线 V1**：[prototype-v1/storyline-v1.html](prototype-v1/storyline-v1.html)（业务确认稿，自包含单文件）。
- **页面地图 V1**：[prototype-v1/page-map-v1.html](prototype-v1/page-map-v1.html)（自包含单文件）。

本地直接双击 HTML 即可打开；如浏览器限制模块脚本，可用任意静态文件服务器（如 `python3 -m http.server`）从 `prototype-v1/` 上级目录起服务。

## 权威性声明

- `manifest.json` 的 `selected` 数组与上表 9 个最终入口是**权威定版**；`pages` 数组中未选中的 30 个探索版本（`*-v1/v2/v3.html`）仅用于历史对照，**非权威**，且未随仓库提交（完整探索稿在阶段 0 输入包 `tcp-prototype-baseline-selected-20260816.tar.gz`，SHA256 `5875a74d859ad3bc720999560322f7217a8137b96ba08336ebd220e67850646d`）。
- 单一打包 JS（`assets/index-LwRo0KzH.js`）内含原候选版本实现且保持未改；定版索引通过轻量 URL 桥把 M02 导向 `pages/m02-selected.html`，其高保真差异位于 `assets/m02-inline-expand.css` 和 `assets/m02-inline-expand.js`。
- 原型展示的指标数字（如 D01 本周学习时间、任务数等）仅为界面示例，口径须经独立 Issue 确认后方可实施。

## 验证

- 打开检查与无页面错误验证在 Issue #187 阶段 0 交付时执行（headless Chromium，1440/1024/768）；自动打开检查与人工视觉结论是两个不同层面，人工视觉验收不属于阶段 0 范围。
