import { dirname, join, relative, resolve } from "node:path";
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";

import type { ToolContext, ToolError, ToolOk, ToolResult } from "../core/agent";

export type McpToolHandler = (args: any, ctx: ToolContext) => Promise<ToolResult>;

export interface McpServerDefinition {
  id: string;
  tools: Record<string, McpToolHandler>;
}

export interface McpCoreServerOptions {
  root?: string;
}

const DEFAULT_WORKSPACE_ROOT = process.env.AOS_WORKSPACE_ROOT ?? join(process.cwd(), "workspace");

function normaliseRoot(root?: string): string {
  return resolve(root ?? DEFAULT_WORKSPACE_ROOT);
}

function isSubPath(root: string, target: string): boolean {
  const relativePath = relative(root, target);
  return relativePath === "" || (!relativePath.startsWith("..") && !relativePath.includes(":"));
}

function resolveWorkspacePath(root: string, target: string): string {
  const normalisedRoot = normaliseRoot(root);
  const trimmed = typeof target === "string" ? target.trim() : "";
  const candidate = trimmed ? resolve(normalisedRoot, trimmed) : normalisedRoot;
  if (!isSubPath(normalisedRoot, candidate)) {
    throw new Error(`path ${target} is outside of workspace root`);
  }
  return candidate;
}

function createToolError(code: string, message: string): ToolError {
  return { ok: false, code, message } satisfies ToolError;
}

async function ensureParentDir(filePath: string): Promise<void> {
  const dir = dirname(filePath);
  await mkdir(dir, { recursive: true });
}

export function createCoreMcpServer(options: McpCoreServerOptions = {}): McpServerDefinition {
  const root = normaliseRoot(options.root);

  const handlers: Record<string, McpToolHandler> = {
    async "file.read"(args: any, _ctx: ToolContext): Promise<ToolResult> {
      const pathInput = typeof args?.path === "string" ? args.path : "";
      if (!pathInput) {
        return createToolError("file.invalid_path", "path is required");
      }
      try {
        const absolutePath = resolveWorkspacePath(root, pathInput);
        const content = await readFile(absolutePath, "utf8");
        const bytes = Buffer.byteLength(content, "utf8");
        return {
          ok: true,
          data: {
            path: pathInput,
            absolute_path: absolutePath,
            content,
            bytes,
          },
        } satisfies ToolOk;
      } catch (err: any) {
        if (err && err.code === "ENOENT") {
          return createToolError("file.not_found", `file not found: ${pathInput}`);
        }
        const message = err instanceof Error ? err.message : "failed to read file";
        return createToolError("file.read_error", message);
      }
    },

    async "file.write"(args: any, _ctx: ToolContext): Promise<ToolResult> {
      const pathInput = typeof args?.path === "string" ? args.path : "";
      const content = typeof args?.content === "string" ? args.content : undefined;
      const encoding = typeof args?.encoding === "string" ? args.encoding : "utf8";
      if (!pathInput) {
        return createToolError("file.invalid_path", "path is required");
      }
      if (typeof content !== "string") {
        return createToolError("file.invalid_content", "content must be a string");
      }
      try {
        const absolutePath = resolveWorkspacePath(root, pathInput);
        await ensureParentDir(absolutePath);
        await writeFile(absolutePath, content, { encoding: encoding as BufferEncoding });
        const bytes = Buffer.byteLength(content, encoding as BufferEncoding);
        return {
          ok: true,
          data: {
            path: pathInput,
            absolute_path: absolutePath,
            bytes,
            encoding,
          },
        } satisfies ToolOk;
      } catch (err: any) {
        const message = err instanceof Error ? err.message : "failed to write file";
        return createToolError("file.write_error", message);
      }
    },

    async "file.list"(args: any, _ctx: ToolContext): Promise<ToolResult> {
      const pathInput = typeof args?.path === "string" && args.path.length > 0 ? args.path : ".";
      try {
        const absolutePath = resolveWorkspacePath(root, pathInput);
        const dirEntries = await readdir(absolutePath, { withFileTypes: true });
        const entries = await Promise.all(
          dirEntries.map(async (entry) => {
            const entryPath = join(absolutePath, entry.name);
            const kind = entry.isDirectory() ? "dir" : entry.isFile() ? "file" : "other";
            const relativePath = relative(root, entryPath) || entry.name;
            let size = 0;
            if (entry.isFile()) {
              const stats = await stat(entryPath);
              size = stats.size;
            }
            return {
              name: entry.name,
              path: relativePath,
              kind,
              size,
            };
          }),
        );
        entries.sort((a, b) => a.path.localeCompare(b.path));
        return {
          ok: true,
          data: {
            path: pathInput,
            absolute_path: resolveWorkspacePath(root, pathInput),
            entries,
          },
        } satisfies ToolOk;
      } catch (err: any) {
        if (err && err.code === "ENOENT") {
          return createToolError("file.not_found", `directory not found: ${pathInput}`);
        }
        const message = err instanceof Error ? err.message : "failed to list directory";
        return createToolError("file.list_error", message);
      }
    },
  } satisfies Record<string, McpToolHandler>;

  return {
    id: "mcp-core",
    tools: handlers,
  } satisfies McpServerDefinition;
}
