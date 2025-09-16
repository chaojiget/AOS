# Contributing to AOS

感谢你对 AOS 项目的关注！为了帮助大家顺利协作，请在开始工作前阅读并遵循以下流程与规范。

## 开发流程

1. **了解需求**：在开始实现前确认问题或需求已在 issue、任务单或会议纪要中记录，并理解验收标准。
2. **准备环境**：
   - Node.js 20 或以上版本。
   - 使用 `pnpm setup` 安装依赖。
3. **开发节奏**：
   - 从主分支创建本地工作副本，不要直接在主分支提交。
   - 每个功能或修复保持独立提交与 PR，最小化变更范围。
   - 开发过程中请按照“计划 → 实现 → 自测 → 提交”的顺序推进。
4. **自测清单**（提交 PR 前）：
   - `pnpm typecheck`
   - `pnpm lint`
   - `pnpm test`
   - `pnpm smoke`
   - 其他与任务相关的专项测试或验证。
5. **提交 PR**：
   - 在描述中说明改动背景、方案和测试结果。
   - 附上关键截图或报告（如 episodes、reports）。
   - 准备好 reviewer 所需的信息，并响应所有 review 反馈。

## 代码规范

- 使用 TypeScript/JavaScript 代码时遵循现有 ESLint、Prettier 和 TypeScript 配置。
- 保持模块职责清晰，优先编写小而易测试的函数。
- 文档使用 Markdown，标题从一级开始逐级递进。
- 提交前确保本地通过静态检查与测试。
- 若引入新的依赖或脚本，请更新相关文档（如 README、AGENTS.md 等）。

## 提交信息格式

提交信息应简明描述变更内容，推荐使用以下格式：

```
<type>: <subject>

<body>
```

- **type**：例如 `feat`、`fix`、`docs`、`chore`、`refactor`、`test` 等。
- **subject**：使用祈使句，简短直接地说明本次改动。
- **body**（可选）：补充改动细节、背景或影响范围。
- 如涉及 issue，请在 body 中引用（例如 `Refs #123`）。

感谢所有贡献者的努力！
