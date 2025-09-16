# AOS

<<<<<<< HEAD
Agent Operating System（AOS）旨在提供一个可回放、可量化的智能体运行平台，结合微内核、插件与本地技能，实现 Plan→Execute→Review→Replay 的闭环能力。

## 快速导航

- [文档索引](docs/README.md)：集中入口，包含设计文档、操作手册与历史需求。
- [项目目录索引](docs/目录索引.md)：解释顶层目录职责，帮助新成员建立整体认知。
- [详细设计与 API 契约](docs/详细设计与API契约.md)：系统架构、数据流、端点定义与运行流程图。
- [Episodes 与 Replay 操作手册](docs/操作指南_Episodes与Replay.md)：示例任务、回放及评分指南。

## 社区与协作

- [贡献指南](CONTRIBUTING.md)：了解开发流程、代码规范与提交信息要求。
- [行为准则](CODE_OF_CONDUCT.md)：参与社区活动时请遵循的行为守则。
- Issue 模板：
  - [Bug 报告](.github/ISSUE_TEMPLATE/bug_report.md)
  - [功能需求](.github/ISSUE_TEMPLATE/feature_request.md)

更多背景资料可参考 `docs/` 目录。

## 项目简介

AOS（Agent Operating System）旨在为单体智能体提供一个可回放、可审计的最小运行内核。项目聚焦于以 TypeScript 为主的统一技术栈，通过 `perceive → plan → act → review → final` 的闭环将感知、计划、执行与评审串联，帮助开发者快速验证 Agent 的真实表现并基于日志迭代策略。

## 核心特性

- **最小可信闭环**：围绕感知、计划、执行、评审与产出的 RunLoop，保证每次任务都有清晰的生命周期。
- **Episode 事件日志**：以追加写 JSONL 记录所有事件，支持离线回放、审计与故障排查。
- **可回放与指数工具链**：通过 `pnpm replay`、`pnpm smoke` 等脚本重放最近的任务轨迹并生成报告。
- **工具/MCP 兼容层**：统一封装 LLM 与工具调用，便于扩展新的感知与行动能力。
- **TypeScript 一体化**：前后端、CLI 与脚本共享类型定义，降低契约漂移风险。

## 安装与启动

在开始之前，请确保本地已安装 Node.js ≥ 20 以及 `pnpm`。

```bash
pnpm setup     # 安装依赖
pnpm dev       # 启动前端/服务端应用（若已实现）
pnpm lint      # 运行 ESLint 检查
pnpm typecheck # 执行 TypeScript 类型检查
pnpm test      # 运行单元测试
pnpm smoke     # 触发最小闭环并生成 episodes + reports
pnpm replay    # 回放最近一次运行
```

## 目录结构

当前仓库处于需求与设计沉淀阶段，核心资料位于 `docs/` 目录。随着实现推进，代码结构将逐步演化为以下骨架：

```text
.
├── README.md            # 项目概览与操作指南
├── docs/                # 需求文档、设计草稿与路线图
├── kernel/              # 事件总线、内存与守护（规划中）
├── plugins/             # planner / executor / critic / reviser 等可插拔组件（规划中）
├── packages/            # provider、agents registry、prompts、schemas（规划中）
├── apps/                # Web/Console 前端与服务端入口（规划中）
├── skills/              # 内置技能示例（如 csv.clean、stats.aggregate）（规划中）
├── tests/               # 单元、集成与回放测试（规划中）
├── episodes/            # 运行事件日志（规划中）
└── reports/             # 冒烟与评审报告（规划中）
```

> 详细的运行边界、最小文件清单与命名规范可在需求文档中查阅。

## 项目状态与后续规划

- **当前状态**：需求草稿阶段，聚焦定义最小可行的 Agent Kernel、事件日志与回放能力。
- **路线图与规划**：请参考《<a href="docs/需求草稿/Agent Os（aos）草稿需求·v0.md">AgentOS（AOS）最小核 · Agent Kernel v0</a>》，其中包含详细的设计原则、MVP 范围与演进计划。

## 持续集成

仓库使用 [`.github/workflows/ci.yml`](.github/workflows/ci.yml) 中定义的 `CI` GitHub Actions 工作流。它在 Node.js 20 上安装 pnpm 并依次运行 `pnpm setup`、`pnpm typecheck`、`pnpm lint`、`pnpm test`、`pnpm build` 和 `pnpm smoke`。成功运行后会产生最新的 `episodes/` 和 `reports/` 目录作为可下载的工件。

要将 CI 设置为合并门禁，请在 GitHub 设置中保护默认分支，并将 `CI` 工作流检查标记为合并 PR 前的必需检查。

更多工作流规范、质量门禁与守护策略请阅读仓库根目录的 `AGENTS.md`。

欢迎通过 Issue 或 PR 参与共建，一起完善 Agent Operating System 的基础能力。
