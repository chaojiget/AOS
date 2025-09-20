# PROJECT.md — AOS 项目治理与协作蓝图

> 读者：项目发起人、产品/技术负责人、Guardian，以及需要了解治理流程的高级协作者。
> 目的：沉淀 Stage-Gate、RACI、Intake、发布策略等规划信息，避免与代理执行手册混杂。
> 若需具体编码与交付指引，请返回根目录的 `AGENTS.md`。

## 1. 项目速览（AOS v0.1）

- **形态**：前台单 Agent（聊天/控制台），后台微内核 + 可替换的 Planner/Executor/Critic/Reviser。
- **最小可信闭环**：Perceive → Plan → Execute → Review → Patch(once) → Log → Replay。
- **主要交付物目录**：`/kernel`（事件总线与守护）、`/packages`（模型/策略）、`/apps`（Next.js 服务）、`/skills`（离线能力）、`/tests`（unit/integration/replay）、`/episodes` 与 `/reports`（可回放证据）。
- **Agent 操作规范**：详见 `AGENTS.md` §0-§16。

## 2. 联系与品牌

- 品牌：**超级个体工程局**；角色：**超级个体实践者**。
- 反馈：在 PR 或 Issue 中附 `trace_id` 与 `episodes` 片段，便于回放与定位。
- 更新策略：若命令/契约变更，需先更新 `AGENTS.md`/`PROJECT.md` 再提交实现，确保所有协作者使用同一版本的护栏。

## 3. RUE SRS 模板

> 当需要补全或更新需求说明时，请依据本节模板生成 `docs/SRS.yaml`。

```yaml
goal: "生成10条视频选题并按热度排序"
constraints: ["成本≤¥1", "完成≤2min", "引用近1年数据"]
acceptance:
  - id: A1
    given: "已有历史视频标题与表现数据"
    when: "运行 ideation.rank"
    then: "产出10条并包含热度分与来源链接"
risks: ["数据源不全→回退本地语料", "热点歧义→人工确认"]
```

## 4. 开发流程（Stage-Gate）

> 把“能跑通”当度量中心：每个阶段都必须产出可回放的证据。

**阶段 → 目标 → 输入 → 产物/门禁（Artifacts/Gates）**

1. **Intake（需求收集）**
   - 目标：澄清目标与边界；形成 RUE SRS。
   - 输入：用户诉求/素材。
   - 产物：`docs/SRS.yaml`（见 §3 模板）；门禁：SRS 至少含 `goal/constraints/acceptance/risks`。
2. **Discovery（探索与方案）**
   - 目标：选方案（离线优先/最小成本）。
   - 产物：`docs/decision.md`（方案对比/权衡矩阵）。门禁：选型理由 + 回退策略。
3. **Plan（计划）**
   - 目标：生成 `plan.json`（Schema 见 `AGENTS.md` §4.2）。
   - 门禁：Plan 经 Reviewer 批准（R/A 签名或评论记录）。
4. **Implement（实现）**
   - 目标：最小纵切；先冒烟后美化。
   - 产物：代码 + 单测；门禁：`pnpm typecheck && pnpm test` 通过。
5. **Review（评审）**
   - 目标：`Critic.review()` 打分。
   - 产物：`review.scored` 事件、分数报告；门禁：`score ≥ 0.8`。
6. **Patch-Once（一次修补）**
   - 目标：仅一次 `Reviser.revise()`；记录差异。
   - 门禁：仍未达标则 Stop 并产出改进建议。
7. **Stabilize（稳定/冒烟）**
   - 目标：端到端冒烟 `pnpm smoke`。
   - 产物：`episodes/*`、`reports/*`；门禁：回放一致（`pnpm replay`）。
8. **Release（发布）**
   - 目标：合并/打标签。
   - 产物：`CHANGELOG.md`、构建产物；门禁：CI 全绿（见 `AGENTS.md` §13）。
9. **Observe（观察）**
   - 目标：收集 p50/p95/成功率/成本。
   - 产物：`scores.csv|sqlite`；门禁：指标未退化。
10. **Learn（沉淀）**

- 目标：把经验写入 `AGENTS.md`/`recipes`，更新护栏与脚本。

## 5. 角色与职责（RACI + Solo 兼容）

**角色定义**

- **PO**（Product Owner）：确定价值与优先级；维护 SRS。
- **TL**（Tech Lead）：架构决策/质量门禁；批准 Plan。
- **FE**（前端）：页面与交互实现；性能与 a11y 负责人。
- **BE/Infra**：API/服务/CI；可由 FE 兼任。
- **QA**：验收与回放；维护冒烟用例。
- **Guardian**：预算/SLA/权限审批（可由 TL 兼任）。
- **Agent（AI 编码代理）**：撰写草案/实现/单测；遵循 `AGENTS.md`。

**RACI 规则（可扩展）**

- R=Responsible（负责人/执行），A=Approver（最终拍板），C=Consulted（咨询），I=Informed（知会）。
- **Solo 模式**：人类可兼任 PO/TL/FE/QA；但仍要求“自评前换帽子”：
  - 写代码时是 **FE(R)**；提交评审前切换为 **QA(R)**；合并前切换为 **TL(A)**。
  - AI 代理默认 **R**，人类在关键 Gate 执行 **A**。

## 6. 阶段-角色切换矩阵（D/R/A/C）

| 阶段          | Driver(D) | Reviewer(R) | Approver(A) | Consulted(C) |
| ------------- | --------- | ----------- | ----------- | ------------ |
| Intake        | PO        | TL          | PO          | Agent        |
| Discovery     | TL        | PO          | TL          | FE/Agent     |
| Plan          | Agent     | TL          | TL          | PO/QA        |
| Implement     | Agent/FE  | TL          | —           | QA           |
| Review        | QA        | TL          | TL          | Agent        |
| Patch-Once    | Agent     | TL          | TL          | QA           |
| Stabilize     | QA        | TL          | TL          | FE/BE        |
| Release       | TL        | QA          | PO/TL       | —            |
| Observe/Learn | TL        | PO          | PO          | 全员         |

> 若单人作业：同一人切帽执行，但**提交前必须跑 CI + 回放**，并在 PR 描述中注明“已切换角色完成自审”。

## 7. 升级/金丝雀/回滚策略

- **金丝雀**：5% 流量或 100 次任务；观察 72h 或达样本阈值。
- **晋升**：`Utility = α·Quality + δ·Satisfaction − β·Cost − γ·Latency` 改善且置信通过 → Promote。
- **回滚**：指标退化或异常率 > 基线 2×；一键回滚到上个稳定版本，保留失败 `episodes` 供复盘。

## 8. Intake（多角度需求引导 + DoR 准入关）

### 8.1 多角度需求问法

1. **业务价值**：本次需求的战略目标、关键指标、优先级？若成功上线会带来哪些量化收益？
2. **用户 & JTBD**：目标人群是谁、当前痛点是什么、期望完成的工作（Jobs-to-be-done）是哪些？
3. **范围（MoSCoW）**：Must/Should/Could/Won’t 的边界如何划分？是否存在阶段性交付？
4. **数据 & 集成**：需要哪些数据源、上下游系统、接口契约、脱敏策略？是否新增存储或 ETL？
5. **体验 / 性能 / a11y**：关键交互、性能目标（如 TTI、p95）、可访问性要求、兼容性矩阵？
6. **非功能**：可观测性、可维护性、弹性伸缩、日志留存、审计要求？
7. **安全 & 合规**：数据分类分级、权限模型、合规或隐私条款、第三方评估？
8. **风险 & 红线**：潜在失败模式、灾备方案、兜底机制、是否触发 Guardian 审批？
9. **预算 / SLA / 治理**：成本上限、SLA/SLI、容量规划、是否需要成本回收或限流策略？
10. **发布 & 回滚**：上线窗口、灰度比例、回滚标准、监控看板、人工值守要求？
11. **验收 & 度量**：接受标准、验收人、度量方式（定量/定性）、上线后观测口径？

> 提示：以上问题应在 `pnpm intake` 与需求评审时逐项触达，可根据实际场景增删。

### 8.2 DoR（Definition of Ready）核对表

需求进入 Plan/实现前，必须满足以下条件，否则自动停机并生成改进建议：

- ✅ 目标业务价值已量化，优先级被 PO/TL 确认。
- ✅ 关键用户画像、JTBD、成功判定标准明确。
- ✅ Must 范围 + 非功能需求 + 风险清单均已落档。
- ✅ 数据、接口、权限、脱敏策略与预算 / SLA 已评审通过。
- ✅ 至少 3 条验收标准（Given/When/Then），并约定验收角色。
- ✅ 具备回滚/兜底方案与发布计划。
- ✅ 提供测试数据或生成/脱敏方案。

> 未满足任一条目：`pnpm intake`、Issue 模板与 Guardian 均会拒绝进入 Plan 阶段。

### 8.3 工具化落地

- `.github/ISSUE_TEMPLATE/feature_request.yml`：提交 Feature Issue 时即填写多角度问题与 DoR 条件，未达标无法提交。
- `pnpm intake`：交互式问答 → 生成/更新 `docs/SRS.yaml` → 按 `docs/srs.schema.json` 校验 → 输出 DoR 通过/失败原因。
- 交付产出：命令会在控制台打印缺失项，同时以 JSON 写入 `reports/intake-summary.json`（供 Guardian 审计）。

### 8.4 红线 / 停机条件

以下任一触发即刻中断流水线，需补全后方可继续：

- 未生成或缺失 `docs/SRS.yaml`；
- 验收条目 < 3 条或缺少 G/W/T 结构；
- 无测试数据、脱敏方案或权限审批；
- 未声明预算/SLA/权限模型；
- 命中合规/安全红线（含 PII 泄漏、跨境传输未审批等）。

> Guardian 需记录放行决策与补救计划；若无法满足红线，请终止迭代并上报。
