# Episodes 与 Replay 操作手册

本手册演示如何在本地生成示例 Episode、查看事件轨迹，并使用 Replay 功能进行离线回放与评分校验。请在执行前阅读仓库根目录下的 `AGENTS.md` 获取完整的工作流约束。

## 1. 前置条件

- Node.js ≥ 20，已安装 `pnpm`。
- 仓库依赖已安装：`pnpm setup`
- 至少执行过一次 `plan.json` 编写流程（每次运行前建议更新目标与约束）。

## 2. 快速开始：生成示例 Episode

1. 在项目根目录运行：
   ```bash
   pnpm smoke
   ```
   - 该脚本会触发最小 Plan→Execute→Review 闭环，自动生成一次示例任务。
   - 运行完成后在终端输出最近一次 `trace_id`，并写入 `episodes/<trace_id>.json` 与 `reports/<trace_id>.md`。
2. 验证产物是否生成：
   ```bash
   ls episodes/
   ls reports/
   ```
3. 打开事件轨迹，理解事件结构：
   ```bash
   cat episodes/<trace_id>.json | jq '.[0:5]'
   ```
   - 每个事件包含 `type`、`timestamp`、`payload` 等字段。
   - 头部记录运行时所使用的模型、成本、延迟等信息，便于后续追踪。

## 3. 回放最近一次 Episode

1. 执行回放命令：
   ```bash
   pnpm replay
   ```
   - 默认回放最近一次生成的 `trace_id`。
   - 回放过程中会固定 provider、temperature=0 与 seed，确保结果可重复。
2. 查看回放结果：
   - 终端会打印对比：原始评分 vs. 回放评分；如有差异请排查差异原因。
   - 新的回放报告会写入 `reports/<trace_id>-replay.md`（具体命名以实现为准）。
3. 失败排查建议：
   - 检查 `episodes/<trace_id>.json` 中是否存在 `error`/`warn` 事件。
   - 确认本地依赖与原运行环境一致（Node 版本、技能依赖等）。
   - 若差异来自外部 LLM，不要直接重试，先评估是否能降级到本地技能。

## 4. 对运行结果评分

- 使用 `pnpm score` 计算指标汇总：
  ```bash
  pnpm score
  ```
  - 输出将包含成功率、平均延迟、成本等核心指标。
  - 生成的 `scores.csv` 可用于长期跟踪模型表现。

## 5. 常见问题（FAQ）

| 问题 | 可能原因 | 建议操作 |
| --- | --- | --- |
| `pnpm smoke` 失败 | 依赖缺失、Node 版本不匹配 | 重新执行 `pnpm setup`，确认 Node ≥ 20。 |
| `episodes/` 目录为空 | 冒烟脚本未正确写入或权限不足 | 检查脚本日志；确保仓库对写目录有权限。 |
| 回放评分与原始不一致 | 外部 LLM 存在随机性；技能行为变化 | 设置 `temperature=0`、确认版本；必要时锁定依赖或切换本地技能。 |
| `pnpm replay` 无法定位 trace | 缺失 `episodes/<trace_id>.json` 或文件名错误 | 确认 trace_id 是否存在；必要时在命令中传入 `TRACE_ID=<id>` 环境变量。 |

## 6. 进一步阅读

- [详细设计与 API 契约](./详细设计与API契约.md)
- [项目目录索引](./目录索引.md)
- `AGENTS.md` 中的 §21“排查与开发测试策略”

如需新增脚本或自定义流程，请在变更前更新本手册并在 PR 中同步说明。
