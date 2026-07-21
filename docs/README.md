# TCP 文档导航

> 本目录的业务基线、技术方案、当前交接和验收记录分开维护；不要用某一次测试结果改写业务规则。

## 当前状态（2026-07-17）

- 迭代 0～3 已完成；迭代 3B 的用户 UAT 已确认通过。
- 迭代 4、5 的实现与技术验收已完成，等待用户 UAT（4-5、5-4）。
- 迭代 6 的 UI-01～UI-05、角色权限和 Codex 真实容器浏览器复验已完成；等待用户集成 UAT（6A-4、6B-5）。
- 迭代 7 的种子、端到端 smoke、容器/文档硬化已完成；最终 UAT 与发布决策（7-4）待用户执行。
- 当前无 Codex 实施任务处于执行中；Git Project 的父级迭代卡均为“待用户确认”。

## 阅读路径

| 目的 | 文档 |
|---|---|
| 了解产品范围、角色和业务闭环 | `01_Product.md`、`02_Design.md` |
| 了解逻辑数据对象与页面/原型 | `03_Data.md`、`04_UI.md` |
| 了解技术边界、路由、验收和迭代设计 | `05_Development.md`、`07_AcceptanceMapping.md` |
| 查看当前进度、门禁和下一步 | `06_Roadmap.md`、`HANDOFF.md` |
| 查看已执行技术验收 | `acceptance/ITERATION_3A_TECHNICAL_ACCEPTANCE.md` 至 `ITERATION_6_TECHNICAL_ACCEPTANCE.md`、`07_AcceptanceMapping.md` |
| 查看能力模型与学习计划原始参考 | `reference/CapabilityModel.md`、`reference/LearningPlan.md` |

## 验收口径

- **Codex 技术验收**：测试、构建、容器就绪、只读浏览器验证；不代替用户 UAT。
- **用户 UAT**：按对应 UAT 卡执行含业务写入的场景并给出结论；当前待执行 4-5、5-4、6A-4、6B-5、7-4。
- **发布决策**：仅在最终 UAT 后由用户作出；不因某张测试卡标记 Done 而自动通过。

## 常用验证入口

```bash
docker compose up -d --build
bash scripts/e2e-smoke.sh
TCP_UIUX_PASSWORD=<approved-local-uat-password> python3 scripts/uiux-smoke.py
```

`HANDOFF.md` 是下一位执行者的当前事实源；`06_Roadmap.md` 是进度与门禁面板；Git Project 用于任务状态和责任人同步。
