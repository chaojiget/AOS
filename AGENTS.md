# 使用中文和我交流

# agents.md — Code Agents 协作与交付规范

> 目标：让任何 Code Agent（如 Codex、Claude Code 等）在本仓库中**稳定、可预期且可回滚**地提出方案、实施变更、产出测试与文档，并遵守安全与质量底线。

## 0. 作用域（Scope）

* 本文件仅约束**编程与交付**：代码变更流程、输出格式、质量与安全要求。
* 非目标：不包含业务战略、迭代路线图、商业机密、团队人事信息。

---

## 1. 运行时与栈拨码（Tech Dial）

> 根据项目现实选择一套主栈，另一套为二级支持；未启用的项保持“禁止变更”状态，除非任务明确授权。

* **首选栈（选择其一）**

  * **Node.js / TypeScript**（推荐）：Node ≥ 20，包管器：`pnpm`（首选）/`npm`。严格类型：`"strict": true`。
  * **Python**：Python ≥ 3.11，包/环境：`uv`（首选）或 `pipx + venv`，类型：`pyright`/`mypy`。
* **禁止事项（默认）**

  * 未经任务授权：**不得跨语言迁移**、**不得引入额外运行时**、**不得修改构建脚本与 CI 模板**。
* **系统约束**

  * 统一时区：UTC；日志与测试使用**单调时间**。
  * 统一字符集：UTF-8；统一换行：LF。

---

## 2. 仓库约定（Repo Conventions）

```
/src            # 代码
/tests          # 单元/集成测试（与 src 目录结构镜像）
/scripts        # 开发/CI脚本
/docs           # 面向开发者的技术文档（含 ADR/变更说明）
/fixtures       # 测试/演示数据
/.github        # CI/CD（GitHub示例；按平台替换）
/tools          # 代码生成器、lint 规则、钩子等
```

* 配置集中化：`.editorconfig`、`tsconfig.json`/`pyproject.toml`、`eslint`/`ruff`、`prettier` 等必须存在且受保护。
* 日志、秘钥与大文件：**严禁入库**。使用 `.gitignore`、`.env.example`（不可含真实秘钥）。

---

## 3. 代理工作循环（PAVR：Plan → Act → Verify → Reflect）

**所有 Code Agent 必须按以下步骤输出。未满足即视为失败。**

1. **Plan（计划）**

   * 列出变更目标、影响面（代码、配置、脚本、文档）、风险与回滚路径。
   * 标明**不做的事**（Out of Scope）。
2. **Act（实施）**

   * 以**最小可回滚变更集**完成实现；**禁止大面积重排/重命名**。
   * 每个文件的变更**紧贴目标**，杜绝“顺手优化”。
3. **Verify（验证）**

   * 运行本地检查命令（见 §6）；新增/更新测试用例；贴出**真实执行输出**（精简但可复现）。
   * 标注覆盖的分支与场景，以及**未覆盖的边界**。
4. **Reflect（复盘）**

   * 自评 5\~8 条：复杂度、可维护性、性能/内存、错误处理、兼容性、可观测性、后续债务列表（Backlog）。
   * 将复盘内容同步落档：在 `reflect/` 目录下新增 Markdown，命名形如 `YYYYMMDD-<topic>.md`，记录问题背景、处置方案与遗留风险，供后续迭代参考。

**输出契约（必须遵循的 Markdown 结构）**

```markdown
## Plan
- Goal: ...
- Scope / Out of Scope: ...
- Risks / Rollback: ...

## Diff (Summarized)
- files changed (list) + rationale

## Test
- commands run + concise outputs
- cases added/updated + coverage delta

## Verify
- Lint/Typecheck/Build/Test results (paste key lines)

## Reflect
- Insights (bullets) + Next steps (bullets)
```

---

## 4. 变更安全红线（Hard Gates）

* **不得**删除或改写：许可证、行为准则、安全策略、CI 主流程、发布脚本、版本号策略。
* **不得**提交：秘钥/令牌/私钥、生产连接串、真实个人数据。
* **不得**引入**网络访问**（构建/测试时）除非任务明示；外部 I/O 需可**本地离线模拟**。
* **API/ABI 变更**必须提供**迁移说明**与**兼容层**或**明确的破坏性版本号**。

---

## 5. 代码质量与风格（Quality & Style）

* **Node/TS**：ESM 优先；`eslint` + `prettier`；公共 API 使用 `/** JSDoc */`；禁止 `any` 泄洪。
* **Python**：`ruff` + `black`；类型注解必须 ≥ 新增行数的 80%；公共模块用 `docstring`。
* **架构**：**Functional Core, Imperative Shell**；边界清晰（接口/适配器/领域/基础设施）。
* **错误处理**：显式异常类型 + 语义化错误码；**不得吞错**；日志要含 `error_id` 与 `context`。
* **可测试性**：依赖注入；确定性 I/O；时间/随机数可 stub。

---

## 6. 本地与 CI 命令（Single Source of Truth）

> 无论人还是 Agent，**只运行这些命令**。脚本路径按项目落地。

* **安装**

  * Node：`pnpm i`（或 `npm ci`）
  * Python：`uv sync`（或 `uv pip install -r requirements.txt`）
* **质量闸**

  * Lint：`pnpm lint` / `uv run ruff check .`
  * 类型：`pnpm typecheck` / `uv run pyright`
  * 测试：`pnpm test` / `uv run pytest -q`
  * 构建：`pnpm build` / `uv run python -m build`
* **全部校验**：`pnpm verify` / `make verify`（聚合上面所有步骤）

Agent 在 **Verify** 段落中必须粘贴上述命令的**关键输出**。

---

## 7. 测试与覆盖（Tests）

* 单元优先，必要时加集成；端到端测试用**本地假服务/录制回放**。
* 覆盖目标（默认）：**新增代码行覆盖 ≥ 80%**，关键路径 ≥ 90%。
* 测试命名：`should_<behavior>_when_<condition>`；失败信息可读、可定位。
* 基准/性能测试：对**热路径**提供微基准或上限预算（见 §9）。

---

## 8. 可观测性（Observability）

* 结构化日志（JSON Lines）：`ts`, `level`, `msg`, `component`, `error_id`, `context`。
* 指标埋点：计数（ops）、直方（延迟）、仪表（并发）。
* Trace（可选）：OpenTelemetry 规范事件名，避免高基数标签。
* **禁止**在日志中输出 PII/秘钥/大对象。

---

## 9. 性能与资源预算（Performance Budgets）

* **接口/热路径**必须声明目标：如 p95 延迟 ≤ 50ms，本地峰值 RSS ≤ 256MB。
* 若无法满足，**Plan** 内需说明权衡与还债计划（issue 链接）。

---

## 10. 安全基线（Security）

* 依赖漏洞：启用 `pnpm audit` / `pip-audit`，发现高危需**阻断**合并。
* 反序列化/命令注入/路径穿越：使用白名单与安全 API。
* 网络：默认超时 ≤ 3s，重试带抖动；禁止对内网 RFC1918 直连（除非测试容器）。
* 秘钥管理：仅使用环境变量注入；提供 `./.env.example`。

---

## 11. PR 与提交（PR & Commits）

* **分支命名**：`feat/<scope>-<slug>`、`fix/<scope>-<slug>`、`chore/...`
* **提交规范**（Conventional Commits）：

  ```
  feat(scope): concise summary
  fix(scope): concise summary
  chore(scope): tooling/docs
  ```
* **PR 模板（Agent 必须填满）**

  ```markdown
  ### Summary
  - ...

  ### Plan
  - scope / out-of-scope / risks / rollback

  ### Diff Overview
  - files + rationale

  ### Test Evidence
  - commands + key outputs

  ### Impact & Migration
  - API/ABI changes / .env / config

  ### Checklist
  - [ ] Lint  - [ ] Types  - [ ] Tests  - [ ] Docs  - [ ] Security scan
  ```
* **小步提交**：每次提交都可独立通过 `verify`；禁止“巨型提交”。

---

## 12. 轻量 ADR（Architecture Decision Record）

* 文档路径：`/docs/adr/YYYYMMDD-<slug>.md`
* 内容：背景 → 选项 → 决策 → 后果 → 回滚信号。
* 任何**跨切面**影响（安全、性能、可观测、接口）都要 ADR。

---

## 13. 角色模式（Agent Role Modes）

> 代理可在一次任务内切换角色，但**必须声明当前角色**并产出对应产物。

* **Architect**：边界划分、契约定义、ADR 草案。
* **Coder**：最小变更实现、测试补齐、可回滚。
* **Reviewer**：静态审查清单（安全/质量/性能/可观测/兼容）。
* **Doc Writer**：README 片段、迁移指南、变更日志。

---

## 14. 任务输入模板（供外部下发给 Agent）

```markdown
# Task
- Goal:
- Constraints: (runtime, no-internet, no-migration, etc.)
- Non-goals:
- Acceptance Criteria:
- Risk & Rollback Guardrails:

# Context
- Links / code refs / known issues:

# Deliverables (must)
- PR with sections defined in §3
- Tests updated + evidence
- If API change: migration notes + ADR (if cross-cutting)
```

---

## 15. 自审清单（Self-Review Checklist）

* [ ] 只改了必须改的文件，未顺手重构
* [ ] Lint/Type/Build/Test 全绿，输出已贴
* [ ] 错误路径可追踪（error\_id + context）
* [ ] 性能预算未被破坏 / 已声明偏差与计划
* [ ] 安全敏感点（输入、I/O、依赖、日志）已检查
* [ ] 文档/示例/`.env.example` 已更新
* [ ] 回滚命令与触发条件明确

---

## 16. 禁止与例外（Prohibited & Exceptions）

* 禁止**无授权变更**：依赖大版本升级、构建链、发布流水线。
* 例外通道：在 PR 顶部以 **⚠ Exception Request** 声明，附理由、影响评估与临时性。

---

## 17. 违例处理（Enforcement）

* 机器人或 CI 检查未通过：直接关闭 PR（可重提）。
* 连续两次违例：锁定“高风险文件”写权限，仅允许 Reviewer 触达。

---

### 附录 A：Node/TS 推荐工具集

* Lint：ESLint；格式化：Prettier；类型：tsc
* 测试：Vitest / Jest；打包：tsup / esbuild
* 覆盖：c8；Mock：msw / nock

### 附录 B：Python 推荐工具集

* Lint：ruff；格式化：black；类型：pyright/mypy
* 测试：pytest；打包：uv / hatch
* 覆盖：coverage.py；Mock：responses / freezegun

---

## 结语

**保守合并、激进验证**。每次变更都必须“可证实、可撤回、可持续”。

---
