#!/usr/bin/env node
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const rl = createInterface({ input, output });

function splitList(raw) {
  return raw
    .split(/\r?\n|[,;]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

async function ask(prompt, { required = false } = {}) {
  let answer = "";
  do {
    answer = (await rl.question(prompt)).trim();
    if (!answer && required) {
      console.log("⚠️  必填项，请重新输入。");
    }
  } while (!answer && required);
  return answer;
}

async function collectStakeholders() {
  const stakeholders = [];
  console.log("\n> 输入干系人（格式：姓名|角色|联系方式），至少 1 条，回车结束。");
  let index = 1;
  while (true) {
    const raw = await rl.question(`  干系人 ${index} (留空结束)：`);
    const trimmed = raw.trim();
    if (!trimmed) {
      if (stakeholders.length === 0) {
        console.log("⚠️  至少需要 1 位干系人");
        continue;
      }
      break;
    }
    const [name, role, contact] = trimmed.split("|").map((item) => item.trim());
    if (!name || !role) {
      console.log("⚠️  请输入 姓名|角色|联系方式 格式");
      continue;
    }
    stakeholders.push({ name, role, contact: contact ?? "" });
    index += 1;
  }
  return stakeholders;
}

async function collectUserJobs() {
  const jobs = [];
  console.log("\n> 输入用户与 JTBD（格式：Persona|任务|痛点），至少 1 条，回车结束。");
  let index = 1;
  while (true) {
    const raw = await rl.question(`  用户画像 ${index} (留空结束)：`);
    const trimmed = raw.trim();
    if (!trimmed) {
      if (jobs.length === 0) {
        console.log("⚠️  至少需要 1 个 JTBD 条目");
        continue;
      }
      break;
    }
    const [persona, job, painPoints] = trimmed.split("|").map((item) => item.trim());
    if (!persona || !job) {
      console.log("⚠️  请输入 Persona|任务|痛点 格式");
      continue;
    }
    jobs.push({ persona, job, pain_points: painPoints ?? "" });
    index += 1;
  }
  return jobs;
}

async function collectRisks() {
  const risks = [];
  console.log("\n> 输入风险清单（格式：ID|描述|缓解方案），至少 1 条，回车结束。");
  let index = 1;
  while (true) {
    const raw = await rl.question(`  风险 ${index} (留空结束)：`);
    const trimmed = raw.trim();
    if (!trimmed) {
      if (risks.length === 0) {
        console.log("⚠️  至少需要 1 条风险记录");
        continue;
      }
      break;
    }
    const [id, description, mitigation] = trimmed.split("|").map((item) => item.trim());
    if (!id || !description || !mitigation) {
      console.log("⚠️  请输入 ID|描述|缓解方案 格式");
      continue;
    }
    risks.push({ id, description, mitigation });
    index += 1;
  }
  return risks;
}

async function collectAcceptance() {
  const acceptance = [];
  console.log("\n> 输入验收标准（格式：ID|Given|When|Then）。至少 3 条，继续录入可按回车停止。");
  let index = 1;
  while (true) {
    const raw = await rl.question(`  验收 ${index} (回车结束)：`);
    const trimmed = raw.trim();
    if (!trimmed) {
      if (acceptance.length < 3) {
        console.log("⚠️  至少需要 3 条验收标准");
        continue;
      }
      break;
    }
    const [id, given, when, then] = trimmed.split("|").map((item) => item.trim());
    if (!id || !given || !when || !then) {
      console.log("⚠️  请输入 ID|Given|When|Then 格式");
      continue;
    }
    acceptance.push({ id, given, when, then });
    index += 1;
  }
  return acceptance;
}

function jsonString(value) {
  return JSON.stringify(value ?? "");
}

function dumpYaml(value, indent = 0) {
  const pad = "  ".repeat(indent);
  if (Array.isArray(value)) {
    if (value.length === 0) {
      return `${pad}[]`;
    }
    return value
      .map((item) => {
        if (item && typeof item === "object") {
          const nested = dumpYaml(item, indent + 1);
          return `${pad}-\n${nested}`;
        }
        return `${pad}- ${formatScalar(item)}`;
      })
      .join("\n");
  }
  if (value && typeof value === "object") {
    return Object.entries(value)
      .filter(([, v]) => v !== undefined)
      .map(([key, val]) => {
        if (val && typeof val === "object") {
          const nested = dumpYaml(val, indent + 1);
          const separator = nested.includes("\n") ? `\n${nested}` : ` ${nested.trim()}`;
          return `${pad}${key}:${separator}`;
        }
        return `${pad}${key}: ${formatScalar(val)}`;
      })
      .join("\n");
  }
  return `${pad}${formatScalar(value)}`;
}

function formatScalar(value) {
  if (value === null || value === undefined) return "null";
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return jsonString(String(value));
}

function validateStructure(srs) {
  const errors = [];
  const isString = (value) => typeof value === "string" && value.trim().length > 0;
  const ensureString = (value, message) => {
    if (!isString(value)) errors.push(message);
  };
  const ensureArray = (value, message, min = 1) => {
    if (!Array.isArray(value) || value.length < min) errors.push(message);
  };

  ensureString(srs.meta?.id, "meta.id 缺失或为空");
  ensureString(srs.meta?.title, "meta.title 缺失或为空");
  ensureString(srs.meta?.owner, "meta.owner 缺失或为空");
  ensureArray(srs.meta?.stakeholders, "stakeholders 至少需要 1 项");

  ensureString(srs.value?.business_goal, "business_goal 缺失");
  ensureString(srs.value?.metrics?.north_star, "north_star 缺失");
  ensureArray(srs.value?.user_jobs, "user_jobs 至少需要 1 项");

  ensureArray(srs.scope?.must, "scope.must 至少需要 1 项");
  ensureArray(srs.data?.sources, "data.sources 至少需要 1 项");
  ensureArray(srs.data?.interfaces, "data.interfaces 至少需要 1 项");
  ensureString(srs.data?.masking, "data.masking 缺失");

  ensureString(srs.experience?.notes, "experience.notes 缺失");
  ensureString(srs.experience?.performance, "experience.performance 缺失");
  ensureString(srs.experience?.accessibility, "experience.accessibility 缺失");

  ensureString(srs.non_functional?.observability, "non_functional.observability 缺失");
  ensureString(srs.non_functional?.logging, "non_functional.logging 缺失");
  ensureString(srs.non_functional?.resilience, "non_functional.resilience 缺失");

  ensureString(srs.security?.classification, "security.classification 缺失");
  ensureString(srs.security?.permissions, "security.permissions 缺失");
  ensureString(srs.security?.compliance, "security.compliance 缺失");

  ensureArray(srs.risk_register, "risk_register 至少需要 1 项");
  ensureString(srs.budget?.limit, "budget.limit 缺失");
  ensureString(srs.budget?.sla, "budget.sla 缺失");
  ensureString(srs.budget?.governance, "budget.governance 缺失");

  ensureString(srs.release?.plan, "release.plan 缺失");
  ensureString(srs.release?.rollback, "release.rollback 缺失");
  ensureString(srs.release?.monitoring, "release.monitoring 缺失");

  ensureArray(srs.acceptance, "acceptance 至少需要 3 项", 3);
  ensureString(srs.test_data?.strategy, "test_data.strategy 缺失");

  return errors;
}

function evaluateDor(srs) {
  const missing = [];
  if (!srs.value.business_goal) missing.push("缺少业务价值");
  if (!srs.value.user_jobs?.length) missing.push("未定义用户画像/JTBD");
  if (!srs.scope.must?.length) missing.push("Must 范围为空");
  if (!srs.non_functional.observability || !srs.non_functional.resilience) {
    missing.push("非功能需求不完整");
  }
  if (!srs.security.classification || !srs.security.permissions) {
    missing.push("安全/权限缺失");
  }
  if (!srs.risk_register?.length) missing.push("风险清单为空");
  if (!srs.budget.limit || !srs.budget.sla) missing.push("预算或 SLA 缺失");
  if (!srs.acceptance || srs.acceptance.length < 3) missing.push("验收标准不足 3 条");
  if (!srs.test_data.strategy) missing.push("缺少测试数据/脱敏方案");
  if (!srs.release.plan || !srs.release.rollback) missing.push("缺少发布/回滚计划");
  return { passes: missing.length === 0, missing };
}

async function main() {
  console.log("\n=== 多角度需求引导 / DoR Intake ===\n");
  const meta = {
    id: await ask("需求 ID (如 feature-xxx)：", { required: true }),
    title: await ask("需求标题：", { required: true }),
    owner: await ask("责任人/团队：", { required: true }),
    stakeholders: await collectStakeholders(),
  };

  const value = {
    business_goal: await ask("业务价值与战略目标：", { required: true }),
    metrics: {
      north_star: await ask("北极星指标（可填多个，逗号/分号分隔）：", { required: true }),
      guardrails: splitList(await ask("护栏指标（成本/延迟等，逗号或分号分隔）：")),
    },
    user_jobs: await collectUserJobs(),
  };

  const scope = {
    must: splitList(await ask("Must 范围（使用逗号/分号分隔）：", { required: true })),
    should: splitList(await ask("Should 范围：")),
    could: splitList(await ask("Could 范围：")),
    wont: splitList(await ask("Won't 范围：")),
  };

  const data = {
    sources: splitList(await ask("数据源（逗号/分号分隔）：", { required: true })),
    interfaces: splitList(await ask("上下游接口/系统（逗号/分号分隔）：", { required: true })),
    masking: await ask("脱敏/数据治理策略：", { required: true }),
  };

  const experience = {
    notes: await ask("体验/交互重点：", { required: true }),
    performance: await ask("性能指标（TTI、p95 等）：", { required: true }),
    accessibility: await ask("可访问性与兼容性要求：", { required: true }),
  };

  const nonFunctional = {
    observability: await ask("可观测性/日志策略：", { required: true }),
    logging: await ask("审计/留存要求：", { required: true }),
    resilience: await ask("弹性/降级/维护策略：", { required: true }),
  };

  const security = {
    classification: await ask("数据分级/合规要求：", { required: true }),
    permissions: await ask("权限模型与审批：", { required: true }),
    compliance: await ask("第三方/合规审核说明：", { required: true }),
  };

  const risks = await collectRisks();

  const budget = {
    limit: await ask("预算上限/成本约束：", { required: true }),
    sla: await ask("SLA/SLI 目标：", { required: true }),
    governance: await ask("治理/限流/容量策略：", { required: true }),
  };

  const release = {
    plan: await ask("上线与灰度计划：", { required: true }),
    rollback: await ask("回滚策略：", { required: true }),
    monitoring: await ask("监控/报警/值守安排：", { required: true }),
  };

  const acceptance = await collectAcceptance();

  const testData = {
    strategy: await ask("测试数据或脱敏方案：", { required: true }),
  };

  const srs = {
    meta,
    value,
    scope,
    data,
    experience,
    non_functional: nonFunctional,
    security,
    risk_register: risks,
    budget,
    release,
    acceptance,
    test_data: testData,
  };

  const schemaErrors = validateStructure(srs);
  const { passes, missing } = evaluateDor(srs);

  const yaml = `# Generated by pnpm intake\n${dumpYaml(srs)}\n`;
  const srsPath = resolve("docs", "SRS.yaml");
  await mkdir(resolve("docs"), { recursive: true });
  await writeFile(srsPath, yaml, "utf8");

  await mkdir(resolve("reports"), { recursive: true });
  const summary = {
    generated_at: new Date().toISOString(),
    srs_path: srsPath,
    dor_passed: passes,
    missing,
    acceptance_count: acceptance.length,
    schema_passed: schemaErrors.length === 0,
    schema_errors: schemaErrors,
  };
  await writeFile(
    resolve("reports", "intake-summary.json"),
    JSON.stringify(summary, null, 2),
    "utf8",
  );

  console.log("\n---\nSRS 已写入 docs/SRS.yaml");
  if (schemaErrors.length === 0) {
    console.log("✅ Schema 校验通过");
  } else {
    console.log("❌ Schema 校验未通过：");
    schemaErrors.forEach((item) => console.log(`  - ${item}`));
  }
  if (passes) {
    console.log("✅ DoR 检查通过");
  } else {
    console.log("❌ DoR 检查未通过：");
    missing.forEach((item) => console.log(`  - ${item}`));
  }
}

main()
  .catch((error) => {
    console.error("Intake 失败", error);
    process.exitCode = 1;
  })
  .finally(() => {
    rl.close();
  });
