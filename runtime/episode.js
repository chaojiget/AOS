import { promises as fs } from "node:fs";
import { join } from "node:path";

const { mkdir, stat, readFile, appendFile, writeFile } = fs;
const DEFAULT_VERSION = "v001";

function toISOString(clock) {
  try {
    return (clock ? clock() : new Date()).toISOString();
  } catch {
    return new Date().toISOString();
  }
}

async function ensureFileExists(filePath) {
  try {
    await stat(filePath);
  } catch (error) {
    if (error && error.code === "ENOENT") {
      await writeFile(filePath, "", "utf8");
    } else {
      throw error;
    }
  }
}

async function loadExistingState(filePath) {
  try {
    const text = await readFile(filePath, "utf8");
    if (!text) {
      return { line: 0, offset: 0 };
    }
    const lines = text.split("\n").filter(Boolean);
    return { line: lines.length, offset: Buffer.byteLength(text) };
  } catch (error) {
    if (error && error.code === "ENOENT") {
      return { line: 0, offset: 0 };
    }
    throw error;
  }
}

async function readManifest(manifestPath) {
  try {
    const text = await readFile(manifestPath, "utf8");
    return JSON.parse(text);
  } catch (error) {
    if (error && error.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

async function writeManifest(manifestPath, manifest) {
  const data = JSON.stringify(manifest, null, 2);
  await writeFile(manifestPath, `${data}\n`, "utf8");
}

export class EpisodeLogger {
  constructor(options = {}) {
    const {
      traceId,
      version = DEFAULT_VERSION,
      baseDir = join(process.cwd(), "episodes"),
      clock,
    } = options;
    if (!traceId) {
      throw new Error("EpisodeLogger requires a traceId");
    }
    this.traceId = traceId;
    this.version = version;
    this.baseDir = baseDir;
    this.clock = clock;
    this.dir = join(this.baseDir, this.traceId, this.version);
    this.filePath = join(this.dir, "events.jsonl");
    this.manifestPath = join(this.baseDir, this.traceId, "manifest.json");
    this.line = 0;
    this.offset = 0;
    this.ready = false;
  }

  async init() {
    if (this.ready) return;
    await mkdir(this.dir, { recursive: true });
    await ensureFileExists(this.filePath);
    const existing = await loadExistingState(this.filePath);
    this.line = existing.line;
    this.offset = existing.offset;
    await this.#ensureManifest();
    this.ready = true;
  }

  async #ensureManifest() {
    const manifest = await readManifest(this.manifestPath);
    if (!manifest) {
      const created = {
        trace_id: this.traceId,
        latest_version: this.version,
        versions: {
          [this.version]: {
            file: `./${this.version}/events.jsonl`,
            latest_ln: this.line,
            latest_ts: null,
          },
        },
        created_at: toISOString(this.clock),
      };
      await writeManifest(this.manifestPath, created);
      return;
    }

    if (!manifest.versions) manifest.versions = {};
    manifest.trace_id = this.traceId;
    manifest.latest_version = this.version;
    manifest.versions[this.version] = {
      file: `./${this.version}/events.jsonl`,
      latest_ln: this.line,
      latest_ts: manifest.versions[this.version]?.latest_ts ?? null,
    };
    await writeManifest(this.manifestPath, manifest);
  }

  async log(event) {
    await this.init();
    const record = {
      ...event,
      ts: event?.ts ?? toISOString(this.clock),
      ln: this.line + 1,
      byte_offset: this.offset,
    };
    const line = `${JSON.stringify(record)}\n`;
    await appendFile(this.filePath, line, "utf8");
    this.line += 1;
    this.offset += Buffer.byteLength(line);
    await this.#updateManifest(record);
    return record;
  }

  async #updateManifest(record) {
    const manifest = (await readManifest(this.manifestPath)) ?? {
      trace_id: this.traceId,
      latest_version: this.version,
      versions: {},
    };
    if (!manifest.versions) manifest.versions = {};
    manifest.trace_id = this.traceId;
    manifest.latest_version = this.version;
    manifest.versions[this.version] = {
      file: `./${this.version}/events.jsonl`,
      latest_ln: record.ln,
      latest_ts: record.ts,
    };
    await writeManifest(this.manifestPath, manifest);
  }
}

export default {
  EpisodeLogger,
};
