---
title: Team Capability Platform（TCP）
version: v1.0
status: Frozen
owner: Jimmy
last_updated: 2026-07-12
---

# Team Capability Platform（TCP）

> 基于能力模型的团队能力运营平台（Team Capability Platform）

---

# 1. 项目简介

## 1.1 项目背景

目前团队成员的成长主要依赖：

- 导师经验
- 临时学习安排
- 项目实践
- 年度绩效反馈

存在以下问题：

- 缺少统一的能力标准
- 不同导师评价标准不一致
- 学习目标不清晰
- 学习计划难持续跟踪
- 学习成果无法沉淀
- Leader 难以掌握团队能力建设情况

团队已经建立了《技术架构与开发专业线能力胜任模型》，能够定义不同岗位等级（P4～P8）在各能力域、能力项上的能力要求。

因此，希望建设一套轻量级内部平台，将能力模型数字化，实现团队能力持续运营。

---

## 1.2 产品定位

TCP（Team Capability Platform）不是学习平台。

TCP 是一套：

> **基于能力模型的团队能力运营平台（Capability Operations Platform）。**

平台重点不是：

- 上课程
- 看视频
- 做考试

而是：

> 围绕能力模型持续运营团队能力成长。

---

## 1.3 建设目标

通过平台形成完整能力闭环：

```text
能力模型

↓

能力评估

↓

Gap分析

↓

成长目标

↓

成长计划

↓

学习任务

↓

能力证明

↓

Buddy审核

↓

成长档案

↓

持续提升
```

最终实现：

- 能力标准统一
- 成长路径透明
- 学习过程可跟踪
- 成长成果可验证
- Leader 可运营团队能力

---

# 2. 产品定位

## 产品名称

Team Capability Platform

简称：

TCP

---

## 产品类型

企业内部管理平台

---

## 使用对象

目前：

技术架构与开发团队

未来：

支持多个专业线：

- 产品
- 测试
- 运维
- 数据
- AI
- PM

平台保持统一。

能力模型可扩展。

---

## 建设原则

MVP 优先。

先满足：

一个团队（<10 人）。

后续逐步扩展。

---

# 3. 核心理念

平台遵循以下理念。

---

## 3.1 能力模型驱动

所有成长均来自能力模型。

不是：

课程驱动。

不是：

任务驱动。

而是：

```text
能力模型

↓

能力Gap

↓

成长计划
```

---

## 3.2 能力不是学出来的

课程只是输入。

真正代表能力的是：

Evidence（能力证明）。

例如：

- Demo
- 项目实践
- 技术分享
- 设计方案
- PR
- Code Review
- 技术文章

而不是：

课程完成。

---

## 3.3 Buddy 持续指导

Buddy 不是审批人。

Buddy 更像：

Coach。

职责：

- 指导
- 建议
- Review
- 反馈

帮助成员成长。

---

## 3.4 Leader 做能力运营

Leader 不负责每个人学习。

Leader 负责：

- 能力模型维护
- 学习资源建设
- 团队能力分析
- 年度能力规划

---

# 4. 用户角色

平台支持四类角色。

## Member

团队成员。

负责：

- 自评
- 制定成长计划
- 执行学习任务
- 提交能力证明

---

## Buddy

导师。

负责：

- 指导成员成长
- Review 能力证明
- 提供反馈
- 跟踪成长进度

说明：

一个 Buddy 可以负责多个成员。

---

## Leader

团队负责人。

负责：

- 能力模型维护
- 学习资源维护
- 团队能力分析
- 年度能力规划

Leader 也可以同时是：

- Member
- Buddy

平台采用权限叠加。

---

## Admin

系统管理员。

负责：

- 用户
- 权限
- 参数
- 系统配置

---

# 5. 核心业务闭环

平台围绕一个业务闭环运行。

```mermaid
flowchart LR

A[能力模型]

-->

B[能力评估]

-->

C[Gap分析]

-->

D[成长目标]

-->

E[成长计划]

-->

F[学习任务]

-->

G[能力证明]

-->

H[Buddy审核]

-->

I[成长档案]
```

所有业务都围绕上述流程展开。

---

# 6. 产品能力

平台能力分为四大领域。

---

## Capability

能力管理。

包括：

- 能力模型
- 能力评估
- Gap分析

---

## Growth

成长管理。

包括：

- 成长目标
- 成长计划
- 学习任务
- 成长档案

---

## Mentoring

导师指导。

包括：

- Buddy
- Review
- Feedback

---

## Operations

团队运营。

包括：

- 能力模型维护
- 学习资源维护
- 团队分析
- 数据统计

---

# 7. 文档说明

项目采用 **Docs as Code**。

所有设计文档统一使用 Markdown。

## 文档列表

| 文档 | 说明 |
|------|------|
| README.md | 项目入口 |
| 01_Product.md | 产品定义 |
| 02_Design.md | IA、流程、状态 |
| 03_Data.md | 数据模型 |
| 04_UI.md | 页面设计 |
| 05_Development.md | 开发规范 |
| 06_Roadmap.md | 产品规划 |

---

## 阅读顺序

建议按照以下顺序阅读：

```text
README

↓

01_Product

↓

02_Design

↓

03_Data

↓

04_UI

↓

05_Development

↓

06_Roadmap
```

---

# 8. 技术栈（建议）

| 分类 | 技术 |
|------|------|
| Frontend | React + TypeScript |
| UI | Ant Design Pro |
| Backend | FastAPI |
| ORM | SQLAlchemy |
| Database | PostgreSQL |
| Cache | Redis（预留） |
| Deploy | Docker |
| Reverse Proxy | Nginx |

---

# 9. 开发原则

整个项目遵循以下原则。

## AI First

所有文档均可作为 AI Context。

适用于：

- Claude Code
- Codex
- Cursor
- Trae

---

## Docs as Code

Markdown 为唯一设计源。

所有设计通过 Git 管理。

---

## Single Source of Truth

每项设计只保留一个来源。

禁止多个文档描述同一规则。

---

## MVP First

优先完成：

能够真正投入团队使用。

再逐步优化。

---

# 10. 项目阶段

## Phase 1

MVP

支持：

- 技术架构与开发专业线
- 单团队
- Buddy
- Leader

---

## Phase 2

支持：

多个专业线。

---

## Phase 3

支持：

企业级能力运营。

---

# 11. 当前版本

| 项目 | 内容 |
|------|------|
| Version | v1.0 |
| Status | Design |
| Scope | MVP |
| Team Size | <10 人 |

---

# 12. 文档维护规范

所有文档统一遵循：

- Markdown
- UTF-8
- Mermaid
- Git Version Control

修改原则：

- 优先修改内容
- 不轻易修改文档结构
- 保持文档长期稳定

---

# Appendix

## 名词解释

| 名词 | 说明 |
|------|------|
| Capability Model | 能力模型 |
| Assessment | 能力评估 |
| Gap | 能力差距 |
| Growth Goal | 成长目标 |
| Growth Plan | 成长计划 |
| Learning Task | 学习任务 |
| Evidence | 能力证明 |
| Buddy | 导师 |
| Capability Profile | 成长档案 |

---

**下一份文档：**

> **01_Product.md —— 产品定义（Business Definition）**

---

# 7. 开发环境与工程初始化

当前仓库已完成最小工程脚手架初始化，技术基线为 React + TypeScript + Ant Design Pro/ProComponents、FastAPI、PostgreSQL 和 Docker Compose。

本阶段明确不包含业务页面、业务路由、业务 API、认证、Evidence 文件处理、数据库迁移或业务数据表。

## 7.1 前置环境

- Docker Engine 及 Docker Compose v2
- Node.js 22+ 与 npm 10+
- Python 3.12+

## 7.2 一键启动

在项目根目录执行：

```bash
docker compose up --build
```

服务地址：

- 前端工程壳：<http://localhost:18081>
- FastAPI 健康检查：<http://localhost:18001/health>
- FastAPI 数据库就绪检查：<http://localhost:18001/ready>
- PostgreSQL：`localhost:5432`，数据库 `tcp`，用户 `tcp`，开发密码 `tcp_dev_only`

停止服务：

```bash
docker compose down
```

Compose 只创建 PostgreSQL 命名卷，不包含初始化 SQL 或业务表。

## 7.3 本地运行

前端：

```bash
cd frontend
npm install
npm run dev
```

后端：

```bash
cd backend
python3 -m venv .venv
. .venv/bin/activate
pip install -r requirements-dev.txt
uvicorn app.main:app --reload --port 8000
```

后端环境变量可参考 `backend/.env.example`；本地 PostgreSQL 连接使用 `DATABASE_URL`，默认端口为 `8000`。

## 7.4 质量检查

```bash
cd frontend
npm run lint
npm run format:check
npm run build

cd ../backend
ruff check .
black --check .
pytest
```

## 7.5 当前交付边界

前端只渲染中性的工程壳占位，不实现 TCP 业务页面或业务导航。后端只提供 `/health` 与 `/ready`；`/ready` 仅执行 PostgreSQL `SELECT 1`，不创建表。业务对象、权限、路由、状态和原型绑定以 `docs/01_Product.md` 至 `docs/05_Development.md` 为准，待后续阶段按门禁实现。
