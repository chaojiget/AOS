import { dirname, join } from "node:path";
import { mkdir, readFile, stat, appendFile } from "node:fs/promises";
import type { EventEnvelope } from "./events";

export interface EpisodeLoggerOptions {
  traceId: string;
  dir?: string;
}

export class EpisodeLogger {
  private readonly filePath: string;
  private ready = false;
  private line = 0;
  private byteOffset = 0;
  private queue: Promise<void> = Promise.resolve();

  constructor(private readonly options: EpisodeLoggerOptions) {
    const baseDir = options.dir ?? join(process.cwd(), "episodes");
    this.filePath = join(baseDir, `${options.traceId}.jsonl`);
  }

  private async ensureReady() {
    if (this.ready) return;
    await mkdir(dirname(this.filePath), { recursive: true });
    try {
      const fileStat = await stat(this.filePath);
      this.byteOffset = fileStat.size;
      const content = await readFile(this.filePath, "utf8");
      const lines = content.split("\n").filter(Boolean);
      this.line = lines.length;
    } catch (err: any) {
      if (err && err.code !== "ENOENT") {
        throw err;
      }
      this.byteOffset = 0;
      this.line = 0;
    }
    this.ready = true;
  }

  append(event: EventEnvelope): Promise<EventEnvelope> {
    this.queue = this.queue.then(async () => {
      await this.ensureReady();
      const enriched = event;
      enriched.ln = enriched.ln ?? ++this.line;
      enriched.byte_offset = enriched.byte_offset ?? this.byteOffset;
      const payload = JSON.stringify(enriched) + "\n";
      const bufferLength = Buffer.byteLength(payload);
      await appendFile(this.filePath, payload, "utf8");
      this.byteOffset += bufferLength;
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
}
