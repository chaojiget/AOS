import { dirname, join, relative, resolve } from "node:path";
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";

import type { ToolError, ToolOk, ToolResult } from "../core/agent";

export interface McpCoreServerOptions {
  workspaceRoot?: string;
}

export interface McpServer {
  readonly id: string;
  invoke(tool: string, args: unknown): Promise<ToolResult>;
}

interface DirectoryEntryInfo {
  name: string;
  kind: "file" | "directory" | "other";
  path: string;
  size?: number;
}

interface FileListResult {
  path: string;
  entries: DirectoryEntryInfo[];
}

interface FileReadResult {
  path: string;
  content: string;
}

interface FileWriteResult {
  path: string;
  bytes: number;
}

export class McpCoreServer implements McpServer {
  readonly id = "mcp-core";

  private readonly workspaceRoot: string;

  constructor(options: McpCoreServerOptions = {}) {
    const root = options.workspaceRoot ? resolve(options.workspaceRoot) : process.cwd();
    this.workspaceRoot = root;
  }

  async invoke(tool: string, args: unknown): Promise<ToolResult> {
    switch (tool) {
      case "file.read":
        return this.handleFileRead(args);
      case "file.write":
        return this.handleFileWrite(args);
      case "file.list":
        return this.handleFileList(args);
      default:
        return {
          ok: false,
          code: "mcp.tool_not_found",
          message: `tool ${tool} is not available on server ${this.id}`,
        } satisfies ToolError;
    }
  }

  private async handleFileRead(args: unknown): Promise<ToolResult<FileReadResult>> {
    const pathArg = this.extractPathArgument(args);
    if (!pathArg) {
      return {
        ok: false,
        code: "file.invalid_path",
        message: "path is required",
      } satisfies ToolError;
    }

    const resolved = this.resolveWithinWorkspace(pathArg);
    if (!resolved.ok) {
      return resolved.error;
    }

    try {
      const content = await readFile(resolved.fullPath, "utf8");
      return {
        ok: true,
        data: { path: resolved.relativePath, content },
      } satisfies ToolOk<FileReadResult>;
    } catch (err: any) {
      if (err && err.code === "ENOENT") {
        return {
          ok: false,
          code: "file.not_found",
          message: "file does not exist",
        } satisfies ToolError;
      }
      const message = err instanceof Error ? err.message : "unknown file read error";
      return { ok: false, code: "file.read_error", message } satisfies ToolError;
    }
  }

  private async handleFileWrite(args: unknown): Promise<ToolResult<FileWriteResult>> {
    const pathArg = this.extractPathArgument(args);
    if (!pathArg) {
      return {
        ok: false,
        code: "file.invalid_path",
        message: "path is required",
      } satisfies ToolError;
    }

    const content = this.extractContentArgument(args);
    if (content == null) {
      return {
        ok: false,
        code: "file.invalid_content",
        message: "content must be a string",
      } satisfies ToolError;
    }

    const resolved = this.resolveWithinWorkspace(pathArg);
    if (!resolved.ok) {
      return resolved.error;
    }

    try {
      await mkdir(dirname(resolved.fullPath), { recursive: true });
      await writeFile(resolved.fullPath, content, "utf8");
      const bytes = Buffer.byteLength(content, "utf8");
      return {
        ok: true,
        data: { path: resolved.relativePath, bytes },
      } satisfies ToolOk<FileWriteResult>;
    } catch (err: any) {
      const message = err instanceof Error ? err.message : "unknown file write error";
      return { ok: false, code: "file.write_error", message } satisfies ToolError;
    }
  }

  private async handleFileList(args: unknown): Promise<ToolResult<FileListResult>> {
    const pathArg = this.extractOptionalPathArgument(args);
    const resolved = this.resolveWithinWorkspace(pathArg);
    if (!resolved.ok) {
      return resolved.error;
    }

    try {
      const entries = await readdir(resolved.fullPath, { withFileTypes: true });
      const detailed: DirectoryEntryInfo[] = [];
      for (const entry of entries) {
        const entryPath = join(resolved.fullPath, entry.name);
        const entryRelative = this.toRelativePath(entryPath);
        if (entry.isDirectory()) {
          detailed.push({ name: entry.name, kind: "directory", path: entryRelative });
        } else if (entry.isFile()) {
          const stats = await stat(entryPath);
          detailed.push({
            name: entry.name,
            kind: "file",
            path: entryRelative,
            size: stats.size,
          });
        } else {
          detailed.push({ name: entry.name, kind: "other", path: entryRelative });
        }
      }
      detailed.sort((a, b) => a.name.localeCompare(b.name));
      return {
        ok: true,
        data: {
          path: resolved.relativePath,
          entries: detailed,
        },
      } satisfies ToolOk<FileListResult>;
    } catch (err: any) {
      if (err && err.code === "ENOENT") {
        return {
          ok: false,
          code: "file.not_found",
          message: "directory does not exist",
        } satisfies ToolError;
      }
      const message = err instanceof Error ? err.message : "unknown file list error";
      return { ok: false, code: "file.list_error", message } satisfies ToolError;
    }
  }

  private extractPathArgument(args: unknown): string | undefined {
    if (args && typeof (args as any).path === "string") {
      const value = (args as any).path.trim();
      return value.length > 0 ? value : undefined;
    }
    if (typeof args === "string") {
      const value = args.trim();
      return value.length > 0 ? value : undefined;
    }
    return undefined;
  }

  private extractOptionalPathArgument(args: unknown): string {
    const value = this.extractPathArgument(args);
    return value ?? ".";
  }

  private extractContentArgument(args: unknown): string | undefined {
    if (args && typeof (args as any).content === "string") {
      return (args as any).content;
    }
    return undefined;
  }

  private toRelativePath(target: string): string {
    const relativePath = relative(this.workspaceRoot, target);
    return this.normaliseRelativePath(relativePath);
  }

  private resolveWithinWorkspace(
    requested: string,
  ): { ok: true; fullPath: string; relativePath: string } | { ok: false; error: ToolError } {
    const fullPath = resolve(this.workspaceRoot, requested);
    const relativePath = relative(this.workspaceRoot, fullPath);
    const isOutside =
      relativePath === ""
        ? false
        : relativePath.split(/\\|\//).some((segment) => segment === ".." || segment === "");

    if (isOutside) {
      return {
        ok: false,
        error: {
          ok: false,
          code: "file.out_of_workspace",
          message: "path is outside of the workspace",
        } satisfies ToolError,
      } as const;
    }

    return {
      ok: true,
      fullPath,
      relativePath: this.normaliseRelativePath(relativePath),
    } as const;
  }

  private normaliseRelativePath(value: string): string {
    if (value === "" || value === ".") {
      return ".";
    }
    return value.replace(/\\+/g, "/");
  }
}
