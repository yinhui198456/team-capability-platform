# TCP 文档导航

> 本目录的业务基线、技术方案、当前交接和验收记录分开维护；不要用某一次测试结果改写业务规则。

## 当前状态（2026-08-16）

- 迭代 0～3 已完成；迭代 3B 的用户 UAT 已确认通过。
- 迭代 4、5 的实现与技术验收已完成，等待用户 UAT（4-5、5-4）。
- 迭代 6 的 UI-01～UI-05、角色权限和 Codex 真实容器浏览器复验已完成；等待用户集成 UAT（6A-4、6B-5）。
- 迭代 7 的种子、端到端 smoke、容器/文档硬化已完成；最终 UAT 与发布决策（7-4）待用户执行。
- Issue #63 第三阶段工程收口已完成：跨角色真实 API E2E（5 场景）、必要失败路径、三视口与文档一致性，含一处生产修复（双角色 Buddy 评审历史 403 回退）；见 `acceptance/ISSUE_63_ENGINEERING_CLOSEOUT.md`。PR #71 保持 Draft，#63 UAT 未执行、不得视为通过。
- Issue #187 阶段 0 原型基线（Docs as Code / 静态原型）已完成：第一批 9 页交互原型、故事线与页面地图纳入 `docs/assets/ui-prototypes/prototype-v1/`，索引见 `docs/assets/ui-prototypes/README.md`，页面矩阵见 `docs/04_UI.md` §4.9；详见 [Issue #187](https://github.com/yinhui198456/team-capability-platform/issues/187) 与 [PR #188](https://github.com/yinhui198456/team-capability-platform/pull/188)（Draft，待用户评审）。
- Issue #178 / PR #179 终态：PR #179 为 Open Draft、未合并（head `56deae5`，base `fix/issue-93-responsive-layout`，非 master），#178/#179 仍待处理；旧 PR body/分支不能替代当前 master 基线。

## 阅读路径

| 目的 | 文档 |
|---|---|
| 了解产品范围、角色和业务闭环 | `01_Product.md`、`02_Design.md` |
| 了解逻辑数据对象与页面/原型 | `03_Data.md`、`04_UI.md` |
| 查看页面资产、交互原型与故事线（#187） | `assets/ui-prototypes/README.md` |
| 了解技术边界、路由、验收和迭代设计 | `05_Development.md`、`07_AcceptanceMapping.md` |
| 查看当前进度、门禁和下一步 | `06_Roadmap.md`、`HANDOFF.md` |
| 查看已执行技术验收 | `acceptance/ITERATION_3A_TECHNICAL_ACCEPTANCE.md` 至 `ITERATION_6_TECHNICAL_ACCEPTANCE.md`、`acceptance/ISSUE_63_ENGINEERING_CLOSEOUT.md`、`07_AcceptanceMapping.md` |
| 查看能力模型与学习计划原始参考 | `reference/CapabilityModel.md`、`reference/LearningPlan.md` |
| 查看指标字典（#64 阶段 1 聚合口径） | `reference/metric-dictionary.md` |

## 验收口径

- **Codex 技术验收**：测试、构建、容器就绪、只读浏览器验证；不代替用户 UAT。
- **用户 UAT**：按对应 UAT 卡执行含业务写入的场景并给出结论；当前待执行 4-5、5-4、6A-4、6B-5、7-4 及 Issue #63 UAT（见 `acceptance/ISSUE_63_ENGINEERING_CLOSEOUT.md` §5）。
- **发布决策**：仅在最终 UAT 后由用户作出；不因某张测试卡标记 Done 而自动通过。

## 常用验证入口

```bash
docker compose up -d --build
bash scripts/e2e-smoke.sh
TCP_UIUX_PASSWORD=<approved-local-uat-password> python3 scripts/uiux-smoke.py
```

`HANDOFF.md` 是下一位执行者的当前事实源；`06_Roadmap.md` 是进度与门禁面板；Git Project 用于任务状态和责任人同步。
