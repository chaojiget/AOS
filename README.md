# AOS

Agent Operating System（AOS）旨在提供一个可回放、可量化的智能体运行平台，结合微内核、插件与本地技能，实现 Plan→Execute→Review→Replay 的闭环能力。

## 快速导航

- [文档索引](docs/README.md)：集中入口，包含设计文档、操作手册与历史需求。
- [项目目录索引](docs/目录索引.md)：解释顶层目录职责，帮助新成员建立整体认知。
- [详细设计与 API 契约](docs/详细设计与API契约.md)：系统架构、数据流、端点定义与运行流程图。
- [Episodes 与 Replay 操作手册](docs/操作指南_Episodes与Replay.md)：示例任务、回放及评分指南。

## 最小运行命令

```bash
pnpm setup     # 安装依赖
pnpm dev       # 启动前端/服务端应用（若已实现）
pnpm smoke     # 触发最小闭环并生成 episodes + reports
pnpm replay    # 回放最近一次运行
```

更多工作流规范、质量门禁与守护策略请阅读仓库根目录的 `AGENTS.md`。
