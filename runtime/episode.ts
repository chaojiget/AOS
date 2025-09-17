import { dirname, join } from "node:path";
import { mkdir, readFile, stat, appendFile, writeFile } from "node:fs/promises";
import type { EpisodeIndexEntry } from "../types/logflow";
import type { EventEnvelope } from "./events";

export interface EpisodeLoggerOptions {
  traceId: string;
  dir?: string;
}

export class EpisodeLogger {
  private readonly filePath: string;
  private readonly indexPath: string;
  private ready = false;
  private line = 0;
  private byteOffset = 0;
  private queue: Promise<void> = Promise.resolve();
  private index: EpisodeIndexEntry[] = [];

  constructor(private readonly options: EpisodeLoggerOptions) {
    const baseDir = options.dir ?? join(process.cwd(), "episodes");
    this.filePath = join(baseDir, `${options.traceId}.jsonl`);
    this.indexPath = join(baseDir, `${options.traceId}.index.jsonl`);
  }

  private async ensureReady() {
    if (this.ready) return;
    await mkdir(dirname(this.filePath), { recursive: true });
    try {
      const fileStat = await stat(this.filePath);
      this.byteOffset = fileStat.size;
    } catch (err: any) {
      if (err && err.code !== "ENOENT") {
        throw err;
      }
      this.byteOffset = 0;
      this.line = 0;
    }

    const existingIndex = await readEpisodeIndex(this.options.traceId, this.options.dir);
    if (existingIndex.length) {
      this.index = existingIndex;
      this.line = existingIndex[existingIndex.length - 1]?.ln ?? this.line;
    } else if (this.byteOffset > 0) {
      const rebuilt = await this.rebuildIndexFromLog();
      this.index = rebuilt;
      this.line = rebuilt.at(-1)?.ln ?? this.line;
      if (rebuilt.length) {
        const serialized = rebuilt.map((entry) => JSON.stringify(entry)).join("\n") + "\n";
        await writeFile(this.indexPath, serialized, "utf8");
      }
    }

    this.ready = true;
  }

  append(event: EventEnvelope): Promise<EventEnvelope> {
    this.queue = this.queue.then(async () => {
      await this.ensureReady();
      const enriched = event;
      const nextLine =
        typeof enriched.ln === "number" && enriched.ln > this.line ? enriched.ln : this.line + 1;
      enriched.ln = nextLine;
      this.line = nextLine;
      const startOffset = enriched.byte_offset ?? this.byteOffset;
      enriched.byte_offset = startOffset;
      const payload = JSON.stringify(enriched) + "\n";
      const bufferLength = Buffer.byteLength(payload);
      await appendFile(this.filePath, payload, "utf8");
      this.byteOffset += bufferLength;
      const indexEntry: EpisodeIndexEntry = {
        ln: enriched.ln,
        span_id: enriched.span_id,
        byte_offset: startOffset,
      };
      this.index.push(indexEntry);
      await appendFile(this.indexPath, JSON.stringify(indexEntry) + "\n", "utf8");
    });

    return this.queue.then(() => event);
  }

  async readAll(): Promise<EventEnvelope[]> {
    await this.ensureReady();
    try {
      const content = await readFile(this.filePath, "utf8");
      return content
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line) as EventEnvelope);
    } catch (err: any) {
      if (err && err.code === "ENOENT") {
        return [];
      }
      throw err;
    }
  }

  async readIndex(): Promise<EpisodeIndexEntry[]> {
    await this.ensureReady();
    return [...this.index];
  }

  private async rebuildIndexFromLog(): Promise<EpisodeIndexEntry[]> {
    try {
      const content = await readFile(this.filePath, "utf8");
      if (!content) {
        return [];
      }
      const lines = content.split("\n").filter(Boolean);
      const entries: EpisodeIndexEntry[] = [];
      let offset = 0;
      for (const line of lines) {
        const parsed = JSON.parse(line) as EventEnvelope;
        const ln = parsed.ln ?? entries.length + 1;
        const entry: EpisodeIndexEntry = {
          ln,
          span_id: parsed.span_id,
          byte_offset: offset,
        };
        entries.push(entry);
        offset += Buffer.byteLength(`${line}\n`);
      }
      this.byteOffset = offset;
      return entries;
    } catch (err: any) {
      if (err && err.code === "ENOENT") {
        return [];
      }
      throw err;
    }
  }
}

export async function readEpisodeIndex(
  traceId: string,
  dir?: string,
): Promise<EpisodeIndexEntry[]> {
  const baseDir = dir ?? join(process.cwd(), "episodes");
  const indexPath = join(baseDir, `${traceId}.index.jsonl`);
  try {
    const content = await readFile(indexPath, "utf8");
    if (!content) {
      return [];
    }
    return content
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as EpisodeIndexEntry);
  } catch (err: any) {
    if (err && err.code === "ENOENT") {
      return [];
    }
    throw err;
  }
}
