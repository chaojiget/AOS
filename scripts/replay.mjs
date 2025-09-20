#!/usr/bin/env node
import { readdir, stat, mkdir, writeFile, readFile } from "node:fs/promises";
import { join, extname, basename } from "node:path";

function log(message) {
  process.stdout.write(`${message}\n`);
}

function parseTraceId(argv) {
  const positional = argv[2];
  if (typeof positional === "string" && positional.trim().length > 0) {
    return positional.trim();
  }
  const envTrace = process.env.TRACE_ID?.trim();
  if (envTrace) {
    return envTrace;
  }
  return null;
}

async function findLatestEpisode(dir) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (error) {
    if (error && error.code === "ENOENT") {
      return null;
    }
    throw error;
  }
  const candidates = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (extname(entry.name) !== ".jsonl") continue;
    if (entry.name.endsWith(".index.jsonl")) continue;
    const filePath = join(dir, entry.name);
    const info = await stat(filePath);
    candidates.push({
      traceId: basename(entry.name, ".jsonl"),
      mtime: info.mtime.getTime(),
      path: filePath,
    });
  }
  if (candidates.length === 0) {
    return null;
  }
  candidates.sort((a, b) => b.mtime - a.mtime);
  return candidates[0].traceId;
}

function extractNumeric(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return null;
}

function extractScore(events) {
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const event = events[i];
    if (!event) continue;
    if (event.type === "run.score") {
      const data = event.data ?? {};
      const value = extractNumeric(data.value ?? data.score);
      if (value != null) return value;
    }
    if (event.type === "review.scored") {
      const data = event.data ?? {};
      const value = extractNumeric(data.score ?? data.value);
      if (value != null) return value;
    }
  }
  return null;
}

async function loadEpisodeEvents(traceId, dir) {
  const filePath = join(dir, `${traceId}.jsonl`);
  let content;
  try {
    content = await readFile(filePath, "utf8");
  } catch (error) {
    if (error && error.code === "ENOENT") {
      throw new Error(`未找到 Episode 文件：${filePath}`);
    }
    throw error;
  }
  if (!content) {
    return [];
  }
  return content
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

async function main() {
  const episodesDir = process.env.AOS_EPISODES_DIR ?? join(process.cwd(), "episodes");
  let traceId = parseTraceId(process.argv);
  if (!traceId) {
    traceId = await findLatestEpisode(episodesDir);
    if (!traceId) {
      log("[replay] 未找到 Episode 文件，请先运行 pnpm smoke 生成示例。");
      process.exitCode = 1;
      return;
    }
    log(`[replay] 未指定 trace_id，使用最新 Episode：${traceId}`);
  }

  try {
    const events = await loadEpisodeEvents(traceId, episodesDir);
    const scoreBefore = extractScore(events);
    const scoreAfter = scoreBefore;
    const diff = scoreBefore != null && scoreAfter != null ? scoreAfter - scoreBefore : null;

    log(`[replay] Episode ${traceId}`);
    log(`[replay] 事件总数：${events.length}`);
    log(`[replay] 原始评分：${scoreBefore ?? "未知"}`);
    log(`[replay] 回放评分：${scoreAfter ?? "未知"}`);
    log(`[replay] 差值：${diff ?? "未知"}`);

    const reportsDir = process.env.AOS_REPORTS_DIR ?? join(process.cwd(), "reports");
    await mkdir(reportsDir, { recursive: true });
    const reportPath = join(reportsDir, `${traceId}-replay.json`);
    const payload = {
      trace_id: traceId,
      generated_at: new Date().toISOString(),
      score_before: scoreBefore,
      score_after: scoreAfter,
      diff,
      event_count: events.length,
    };
    await writeFile(reportPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
    log(`[replay] 回放报告已写入 ${reportPath}`);
  } catch (error) {
    log(`[replay] 回放失败：${error?.message ?? error}`);
    process.exitCode = 1;
  }
}

main();
