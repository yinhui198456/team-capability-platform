# Team Capability Platform Delivery Rules

本文件补充工作区 `../AGENTS.md` 和项目 `CLAUDE.md`；不重复其通用规则。

## UI/UX 验收

- `docs/04_UI.md` 与 `docs/assets/ui-prototypes/UI-01..UI-05` 是 UI 验收基线。
- 浏览器验收分为两层：自动 smoke 验证登录、导航和无权限反馈；截图对照验证原型的关键区域、信息层级与交互入口。两层结论必须分开记录。
- API、单元测试或页面可打开，均不能替代原型视觉验收。
- 浏览器测试默认只读；创建、编辑、提交或删除业务数据前，需获得本轮明确授权。

## UAT 与项目状态

- Codex 浏览器验收、用户 UAT 和发布决策是不同门禁。测试卡 `Done` 仅表示测试已执行；正文中的通过/失败结论决定是否可进入下一门禁。
- 将测试结论同步到 Git Project 时，写明测试范围、未执行的写操作、失败项和复验条件。
- UI-01、UI-04、UI-05 的原型差异修复后，先重跑浏览器 UI/UX 验收，再请求用户执行对应 UAT。

## 自动校验

- `scripts/uiux-smoke.py` 只覆盖稳定的浏览器行为契约；不要用脆弱的像素比对替代人工截图验收。
- 修改角色导航或权限反馈后，运行浏览器 smoke 与已有 `scripts/e2e-smoke.sh`。
