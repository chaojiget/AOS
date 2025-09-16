import { promises as fs } from "node:fs";
import { join } from "node:path";

const { readFile, stat } = fs;
const DEFAULT_VERSION = "v001";

function sortEvents(events) {
  return events.slice().sort((a, b) => {
    if (typeof a.ln === "number" && typeof b.ln === "number") {
      return a.ln - b.ln;
    }
    if (a.ts && b.ts) {
      return a.ts.localeCompare(b.ts);
    }
    return 0;
  });
}

async function readEvents(filePath) {
  try {
    await stat(filePath);
  } catch (error) {
    if (error && error.code === "ENOENT") {
      throw new Error(`Episode file not found: ${filePath}`);
    }
    throw error;
  }
  const content = await readFile(filePath, "utf8");
  if (!content.trim()) {
    return [];
  }
  return content
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch (error) {
        throw new Error(`Invalid JSONL line: ${line}`);
      }
    });
}

export class Replay {
  constructor(options = {}) {
    const {
      traceId,
      version = DEFAULT_VERSION,
      baseDir = join(process.cwd(), "episodes"),
    } = options;
    if (!traceId) {
      throw new Error("Replay requires a traceId");
    }
    this.traceId = traceId;
    this.version = version;
    this.baseDir = baseDir;
    this.filePath = join(this.baseDir, this.traceId, this.version, "events.jsonl");
  }

  async load() {
    const events = await readEvents(this.filePath);
    return sortEvents(events);
  }

  async run(onEvent) {
    const events = await this.load();
    if (typeof onEvent === "function") {
      for (let index = 0; index < events.length; index += 1) {
        await onEvent(events[index], index);
      }
    }
    return events;
  }
}

export async function replay(options = {}) {
  const { onEvent, ...rest } = options;
  const runner = new Replay(rest);
  return runner.run(onEvent);
}

export default {
  Replay,
  replay,
};
