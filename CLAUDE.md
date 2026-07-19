# CLAUDE.md

# Team Capability Platform (TCP)

## 1. Project Overview

本项目是一个面向企业研发团队的能力运营平台（Team Capability Platform，简称 TCP）。

**GitHub 仓库：** https://github.com/yinhui198456/team-capability-platform

产品定位：

- 不是 LMS
- 不是考试平台
- 不是课程管理平台
- 不是绩效系统

平台目标：

基于能力模型，帮助团队建立持续能力成长机制。

核心业务闭环：

Capability Model
→ Assessment
→ Gap Analysis
→ Growth Plan
→ Learning Task
→ Evidence
→ Buddy Review
→ Capability Profile

所有功能均围绕该闭环设计。

---

# 2. Source of Truth

请严格按照以下优先级理解项目。

## 一级（业务来源）

capability-model/

包含：

- 技术架构与开发专业线能力胜任模型.xlsx
- 团队成员年度学习计划模板.xlsx

说明：

能力模型、能力等级、学习计划均来源于上述 Excel。

不得自行创造新的业务规则。

---

## 二级（产品设计）

docs/

包括：

01_Product.md

02_Design.md

03_Data.md

04_UI.md

05_Development.md

06_Roadmap.md

其中：

Product 是业务规则唯一来源。

---

## 三级（代码）

frontend/

backend/

database/

代码必须符合文档。

禁止代码领先设计。

---

# 3. Read Order

开始任何工作前，请按以下顺序阅读：

README.md

↓

docs/01_Product.md

↓

docs/02_Design.md

↓

docs/03_Data.md

↓

docs/04_UI.md

↓

docs/05_Development.md

如涉及能力模型，请同时阅读：

capability-model/

下所有 Excel。

---

# 4. Working Principles

## 原则一

先理解。

后设计。

最后编码。

---

## 原则二

不要猜测业务。

信息不足时，请列出需要确认的问题。

---

## 原则三

任何设计修改，

优先修改 Markdown。

再修改代码。

---

## 原则四

不要修改目录结构。

---

## 原则五

不要新增角色。

当前角色固定：

- Member
- Buddy
- Leader
- Admin

---

## 原则六

不要新增核心业务对象。

如需新增，

必须说明原因。

---

## 原则七

保持统一命名。

例如：

Growth Plan

Learning Task

Evidence

Buddy Review

Capability Profile

禁止出现多个名称表示同一个对象。

---

# 5. Current Project Status

当前项目阶段：

产品设计阶段。

尚未开始正式开发。

当前重点：

完善设计文档。

暂不生成大量代码。

---

# 6. Current Document Status

README.md

项目入口。

01_Product.md

已冻结。

02_Design.md

已冻结。

03_Data.md

已冻结。

04_UI.md

待生成。

05_Development.md

待生成。

06_Roadmap.md

待完善。

---

# 7. Preferred Tech Stack

Frontend

- React
- TypeScript
- Ant Design Pro

Backend

- FastAPI
- SQLAlchemy

Database

- PostgreSQL

Deploy

- Docker

Reverse Proxy

- Nginx

---

# 8. Output Requirements

默认输出：

Markdown。

文档：

企业级。

结构化。

不要重复内容。

不要生成大量空洞描述。

所有 Mermaid 图均使用 Mermaid 原生语法。

---

# 9. Task Workflow

收到任务后，请按以下步骤执行：

1. 理解任务。

2. 阅读相关文档。

3. 分析是否缺少信息。

4. 如信息不足，先提出问题。

5. 给出实施方案。

6. 修改指定文档。

7. 最后总结修改内容。

禁止：

未经分析直接生成大量内容。

---

# 10. Coding Workflow

开始编码前：

确认：

Product

↓

Design

↓

Data

均已支持当前开发内容。

如果设计缺失，

优先完善文档。

不要直接补代码。

---

# 11. Review Checklist

提交任何修改前，请检查：

□ 是否符合 Product。

□ 是否符合能力模型。

□ 是否影响已有流程。

□ 是否修改了业务对象。

□ 是否修改了角色。

□ 是否保持统一命名。

□ 是否保持 Markdown 风格一致。

---

# 12. Goal

所有设计应满足：

- 易理解
- 易维护
- 易扩展
- AI 可持续开发

最终实现：

Documentation Driven Development。