import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Buffer } from "node:buffer";
import { describe, it, expect } from "vitest";
import { importTsModule } from "./helpers/loadTsModule.js";

const { EpisodeLogger, readEpisodeIndex } = await importTsModule(
  "../runtime/episode.ts",
  import.meta.url,
);

let sequence = 0;

function createEvent(traceId, type, data = {}) {
  const index = sequence += 1;
  const ts = new Date(Date.UTC(2024, 0, 1, 0, 0, index)).toISOString();
  return {
    id: `event-${index}`,
    ts,
    type,
    version: 1,
    trace_id: traceId,
    data,
  };
}

describe("EpisodeLogger", () => {
  it("appends JSONL entries with monotonic line numbers and offsets", async () => {
    const dir = await mkdtemp(join(tmpdir(), "episode-"));
    const traceId = "trace-123";
    const logger = new EpisodeLogger({ traceId, dir });

    const first = await logger.append(
      createEvent(traceId, "agent.progress", { step: "plan", pct: 0.1 }),
    );
    const second = await logger.append(
      createEvent(traceId, "agent.final", { outputs: { text: "done" } }),
    );

    expect(first.ln).toBe(1);
    expect(first.byte_offset).toBe(0);
    expect(second.ln).toBe(2);
    const firstLineBytes = Buffer.byteLength(`${JSON.stringify(first)}\n`);
    expect(second.byte_offset).toBe(firstLineBytes);

    const filePath = join(dir, `${traceId}.jsonl`);
    const fileContents = await readFile(filePath, "utf8");
    const lines = fileContents.trim().split("\n");
    expect(lines).toHaveLength(2);
    const parsedSecond = JSON.parse(lines[1]);
    expect(parsedSecond.byte_offset).toBe(second.byte_offset);
    expect(parsedSecond.ln).toBe(2);

    const indexPath = join(dir, `${traceId}.index.jsonl`);
    const indexContents = await readFile(indexPath, "utf8");
    const indexEntries = indexContents
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(indexEntries).toHaveLength(2);
    expect(indexEntries[0]).toMatchObject({ ln: 1, byte_offset: 0 });
    expect(indexEntries[1]).toMatchObject({ ln: 2, byte_offset: second.byte_offset });
  });

  it("reads episode index entries via readEpisodeIndex", async () => {
    const dir = await mkdtemp(join(tmpdir(), "episode-index-"));
    const traceId = "trace-index";
    const logger = new EpisodeLogger({ traceId, dir });
    await logger.append(createEvent(traceId, "agent.plan", { steps: [] }));
    await logger.append(createEvent(traceId, "agent.log", { message: "working" }));

    const indexEntries = await readEpisodeIndex(traceId, dir);
    expect(indexEntries).toHaveLength(2);
    expect(indexEntries[0].ln).toBe(1);
    expect(indexEntries[1].ln).toBe(2);
    expect(indexEntries[1].byte_offset > indexEntries[0].byte_offset).toBe(true);
  });
});
