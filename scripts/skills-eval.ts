import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { runDefaultSkillAnalysis } from "../packages/skills/pipeline";
import type { SkillRecord } from "../packages/skills/storage";

interface EvaluationRecord {
  skill_id: string;
  timestamp: string;
  used_count: number;
  win_rate: number;
  status: "passed" | "failed";
  thresholds: { min_usage: number; min_win_rate: number };
}

interface AbTestRecord {
  skill_id: string;
  timestamp: string;
  variant: "candidate" | "control";
  win_rate: number;
  used_count: number;
}

const DEFAULT_MIN_USAGE = Number(process.env.AOS_SKILL_EVAL_MIN_USAGE ?? 3);
const DEFAULT_MIN_WIN_RATE = Number(process.env.AOS_SKILL_EVAL_MIN_WIN ?? 0.6);
const EVALS_PATH = process.env.AOS_EVALS_PATH ?? join(process.cwd(), "runtime", "evals.json");
const AB_TESTS_PATH =
  process.env.AOS_AB_TESTS_PATH ?? join(process.cwd(), "runtime", "ab_tests.json");

async function readRecords<T>(path: string): Promise<T[]> {
  try {
    const payload = await readFile(path, "utf8");
    const parsed = JSON.parse(payload);
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch (error: any) {
    if (error && error.code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

async function appendRecord<T>(path: string, record: T): Promise<void> {
  const records = await readRecords<T>(path);
  records.push(record);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(records, null, 2), "utf8");
}

function evaluateSkill(skill: SkillRecord, thresholds: { minUsage: number; minWinRate: number }) {
  const meetsUsage = skill.used_count >= thresholds.minUsage;
  const meetsWinRate = skill.win_rate >= thresholds.minWinRate;
  return {
    passed: meetsUsage && meetsWinRate,
    meetsUsage,
    meetsWinRate,
  } as const;
}

async function recordEvaluation(
  skill: SkillRecord,
  thresholds: { minUsage: number; minWinRate: number },
  timestamp: string,
): Promise<void> {
  const evaluation: EvaluationRecord = {
    skill_id: skill.id,
    timestamp,
    used_count: skill.used_count,
    win_rate: skill.win_rate,
    status:
      skill.win_rate >= thresholds.minWinRate && skill.used_count >= thresholds.minUsage
        ? "passed"
        : "failed",
    thresholds: { min_usage: thresholds.minUsage, min_win_rate: thresholds.minWinRate },
  };
  await appendRecord<EvaluationRecord>(EVALS_PATH, evaluation);
}

async function recordAbTest(skill: SkillRecord, timestamp: string): Promise<void> {
  const entry: AbTestRecord = {
    skill_id: skill.id,
    timestamp,
    variant: "candidate",
    win_rate: skill.win_rate,
    used_count: skill.used_count,
  };
  await appendRecord<AbTestRecord>(AB_TESTS_PATH, entry);
}

async function main(): Promise<void> {
  const thresholds = { minUsage: DEFAULT_MIN_USAGE, minWinRate: DEFAULT_MIN_WIN_RATE };
  const analysis = await runDefaultSkillAnalysis();
  const timestamp = new Date().toISOString();

  if (analysis.candidates.length === 0) {
    console.log("[skills-eval] No candidate skills detected in latest analysis.");
    return;
  }

  const failures: string[] = [];

  for (const skill of analysis.candidates) {
    const outcome = evaluateSkill(skill, thresholds);
    await recordEvaluation(skill, thresholds, timestamp);
    if (outcome.passed) {
      await recordAbTest(skill, timestamp);
      console.log(
        `[skills-eval] Skill ${skill.id} passed evaluation (${skill.used_count} uses, ${(skill.win_rate * 100).toFixed(1)}% win rate).`,
      );
    } else {
      failures.push(skill.id);
      console.warn(
        `[skills-eval] Skill ${skill.id} failed evaluation (usage ok: ${outcome.meetsUsage}, win-rate ok: ${outcome.meetsWinRate}).`,
      );
    }
  }

  if (failures.length > 0) {
    console.error(
      `[skills-eval] ${failures.length} skill(s) did not meet the rollout gate: ${failures.join(", ")}.`,
    );
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error("[skills-eval] Unexpected failure", error);
  process.exit(1);
});
