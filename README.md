# AOS

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
pnpm setup   # 安装依赖
pnpm dev     # 启动开发服务器（默认 http://localhost:3000）
pnpm lint    # 运行 ESLint 检查
pnpm typecheck  # 执行 TypeScript 类型检查
pnpm test    # 运行单元测试
pnpm smoke   # 执行端到端冒烟流程，生成 episodes/* 与 reports/*
pnpm replay  # 重放最近一次任务轨迹
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

欢迎通过 Issue 或 PR 参与共建，一起完善 Agent Operating System 的基础能力。
