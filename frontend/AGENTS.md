# Frontend Instructions

- 遵循现有 React、TypeScript、Ant Design Pro 的页面/模块模式；接口请求与响应严格对齐后端契约和 `docs/01_Product.md`，UI 对齐 `docs/04_UI.md`。
- 保持固定角色导航与权限边界；用户可见状态、错误和无权限反馈使用中文。失败时保留用户已输入内容，除非用户明确要求清空。
- 修改先补能在旧行为失败的针对性 Vitest 测试；从 `frontend/` 运行受影响 Vitest，再运行项目 eslint、Prettier 和 build 脚本。可见行为还需要获授权的浏览器验收及截图证据。
- 不猜测业务规则、不重构目录、不自建浏览器自动化工具。
