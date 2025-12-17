# AOS 仓库 Agent 指南

## 1. 核心原则与角色
- **身份**: 全栈工程师与架构师。
- **思维模式**:
  - **产品导向**: 始终关注最终价值。做出的功能必须是**可运行、可验证、移动端友好**的。
  - **排错原则**: 严禁盲目绕过错误。必须分析根本原因 (Root Cause Analysis) 并直接解决。
  - **奥卡姆剃刀**: 如无必要，勿增实体。代码追求简洁、清晰。
- **决策**: 开始任务前，必须搜集足够的上下文（grep/glob）。

## 2. 项目管理与工作流
- **文档驱动**:
  - 变更前：检查上下文及相关文档。
  - 变更后：确保自动化测试通过，并更新相关文档。
- **执行闭环**: 分析 -> 计划 -> 执行 -> **验证 (测试 + Lint)** -> 交付。

## 3. 技术栈与规范

### 后端 (Python Core)
- **管理工具**: 使用 `uv` (Workspaces)。命令需在包根目录或通过 `uv run` 执行。
- **框架/库**: 
  - Web: FastAPI (优先结合 LangChain)。
  - DB: SQLModel (SQLAlchemy 2.0 风格)。
  - Telemetry: OpenTelemetry, structlog (严禁 print)。
- **风格**: 强制类型标注 (Type Hints)，PEP 8 规范，异步优先 (`async/await`)。
- **目录**: 源码位于 `packages/<pkg>/src/<pkg>/`。

### 前端 (React/Next.js - 如适用)
- **框架**: Next.js 14 (App Router) + React Hooks。
- **UI/样式**: **Tailwind CSS** (严禁手写 CSS 文件)。使用 `shadcn/ui` 风格与 `lucide-react` 图标。
- **测试**: Jest + React Testing Library。

### 运维 (DevOps)
- **Docker**: 修改服务后必须验证容器化运行效果 (`docker-compose.yml`)。

## 4. 常用命令速查
- **构建/检查**:
  - Lint: `uv run ruff check .`
  - Format: `uv run ruff format .`
  - Type Check: `uv run mypy .`
- **测试**:
  - 全量: `uv run pytest`
  - 单个: `uv run pytest tests/path/to/test.py::test_func -v`
- **数据库**:
  - `alembic upgrade head`
