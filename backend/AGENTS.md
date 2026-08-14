# Backend Instructions

- 遵循现有 FastAPI、SQLAlchemy 和模块结构；API 与数据行为以 `docs/01_Product.md`、`docs/03_Data.md` 和 capability model 为准，不能猜测业务规则。
- 写查询或联表前先核对 schema、字段类型/可空性/默认值及既有 repository 用法。事务边界、授权、并发和幂等性必须与完整调用链一致；共享写入先验证唯一性/重复提交行为。
- 不直接修改数据库或共享环境数据；schema 变更遵循 `backend/app/migrations/AGENTS.md`。
- 缺陷先保留能在旧行为失败的回归测试；从 `backend/` 先跑 `pytest tests/test_<module>.py -v`，再按影响范围运行 `ruff check app tests && black --check app tests` 或 `pytest tests -q`。记录命令、输出和被测 SHA。
