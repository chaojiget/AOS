import { promises as fs } from "node:fs";
import path from "node:path";

export interface MCPServerEntry {
  id: string;
  transport: string;
  url?: string;
  cmd?: string;
  args?: string[];
  [key: string]: unknown;
}

export interface MCPRegistry {
  servers: MCPServerEntry[];
  defaultServerId?: string;
}

const DEFAULT_FILENAME = "mcp.registry.json";

function createEmptyRegistry(): MCPRegistry {
  return { servers: [] };
}

function normalizeRegistry(value: any): MCPRegistry {
  if (!value || typeof value !== "object") {
    return createEmptyRegistry();
  }

  const servers = Array.isArray((value as any).servers)
    ? (value as any).servers
        .filter((server: any) => server && typeof server === "object")
        .map((server: any) => {
          const entry: MCPServerEntry = {
            id: String(server.id ?? ""),
            transport: String(server.transport ?? ""),
          };

          if (!entry.id || !entry.transport) {
            return null;
          }

          if (typeof server.url === "string" && server.url) {
            entry.url = server.url;
          }
          if (typeof server.cmd === "string" && server.cmd) {
            entry.cmd = server.cmd;
          }
          if (Array.isArray(server.args)) {
            entry.args = server.args.filter((arg: any) => typeof arg === "string");
          }

          const extraKeys = Object.keys(server).filter(
            (key) => !["id", "transport", "url", "cmd", "args"].includes(key),
          );
          for (const key of extraKeys) {
            entry[key] = server[key];
          }

          return entry;
        })
        .filter((entry: MCPServerEntry | null): entry is MCPServerEntry => entry !== null)
    : [];

  const registry: MCPRegistry = { servers };

  if (typeof (value as any).defaultServerId === "string" && (value as any).defaultServerId) {
    registry.defaultServerId = (value as any).defaultServerId;
  }

  return registry;
}

export function resolveMCPRegistryPath(customPath?: string): string {
  const candidate = customPath ?? process.env.MCP_REGISTRY_PATH ?? DEFAULT_FILENAME;
  return path.isAbsolute(candidate) ? candidate : path.resolve(process.cwd(), candidate);
}

export async function readMCPRegistry(filePath = resolveMCPRegistryPath()): Promise<MCPRegistry> {
  try {
    const content = await fs.readFile(filePath, "utf8");
    if (!content.trim()) {
      return createEmptyRegistry();
    }
    return normalizeRegistry(JSON.parse(content));
  } catch (error: any) {
    if (error?.code === "ENOENT") {
      return createEmptyRegistry();
    }
    throw error;
  }
}

export async function writeMCPRegistry(
  registry: MCPRegistry,
  filePath = resolveMCPRegistryPath(),
): Promise<void> {
  const normalized = normalizeRegistry(registry);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(normalized, null, 2)}\n`, "utf8");
}

export async function updateMCPRegistry(
  mutator: (registry: MCPRegistry) => void | MCPRegistry | Promise<void | MCPRegistry>,
  filePath = resolveMCPRegistryPath(),
): Promise<MCPRegistry> {
  const current = await readMCPRegistry(filePath);
  const draft: MCPRegistry = JSON.parse(JSON.stringify(current));
  const result = await mutator(draft);
  const next = normalizeRegistry(result ?? draft);
  await writeMCPRegistry(next, filePath);
  return next;
}

export const DEFAULT_MCP_REGISTRY_FILENAME = DEFAULT_FILENAME;
