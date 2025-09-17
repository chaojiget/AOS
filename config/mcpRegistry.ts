import { promises as fs } from "node:fs";
import { dirname, resolve } from "node:path";

export interface MCPServerConfig {
  id: string;
  transport: string;
  url?: string;
  default?: boolean;
  [key: string]: unknown;
}

export interface MCPRegistry {
  servers: MCPServerConfig[];
}

export interface LoadRegistryOptions {
  registryPath?: string;
}

export interface AddServerOptions {
  id: string;
  transport: string;
  url?: string;
  setAsDefault?: boolean;
  registryPath?: string;
}

export interface AddServerResult {
  action: "created" | "updated" | "unchanged";
  defaultChanged: boolean;
  registry: MCPRegistry;
}

const DEFAULT_REGISTRY: MCPRegistry = { servers: [] };

export async function readMCPRegistry(
  options: LoadRegistryOptions = {},
): Promise<MCPRegistry> {
  const registryPath = resolveRegistryPath(options.registryPath);
  try {
    const contents = await fs.readFile(registryPath, "utf8");
    const parsed = JSON.parse(contents) as MCPRegistry;
    if (!parsed.servers || !Array.isArray(parsed.servers)) {
      throw new Error("Invalid registry: missing servers array");
    }
    return {
      servers: parsed.servers.map((server) => ({ ...server })),
    };
  } catch (error: any) {
    if (error?.code === "ENOENT") {
      await initialiseRegistryFile(registryPath);
      return { ...DEFAULT_REGISTRY, servers: [] };
    }
    throw error;
  }
}

export async function addOrUpdateMCPServer(
  options: AddServerOptions,
): Promise<AddServerResult> {
  const registryPath = resolveRegistryPath(options.registryPath);
  const registry = await readMCPRegistry({ registryPath });

  const existingIndex = registry.servers.findIndex((server) => server.id === options.id);
  let action: AddServerResult["action"] = "unchanged";
  let defaultChanged = false;

  if (existingIndex === -1) {
    const newServer: MCPServerConfig = buildServer(options);
    registry.servers.push(newServer);
    action = "created";
  } else {
    const existing = registry.servers[existingIndex];
    const updated = applyServerUpdates(existing, options);
    if (updated) {
      action = "updated";
    }
  }

  if (options.setAsDefault) {
    defaultChanged = updateDefaultServer(registry, options.id);
  }

  if (action !== "unchanged" || defaultChanged) {
    await writeRegistry(registryPath, registry);
  }

  return { action, defaultChanged, registry };
}

async function initialiseRegistryFile(registryPath: string) {
  await fs.mkdir(dirname(registryPath), { recursive: true });
  await writeRegistry(registryPath, DEFAULT_REGISTRY);
}

function resolveRegistryPath(registryPath?: string): string {
  if (registryPath) {
    return resolve(registryPath);
  }
  return resolve(process.cwd(), "mcp.registry.json");
}

function buildServer(options: AddServerOptions): MCPServerConfig {
  const server: MCPServerConfig = {
    id: options.id,
    transport: options.transport,
  };
  if (options.url !== undefined) {
    server.url = options.url;
  }
  return server;
}

function applyServerUpdates(existing: MCPServerConfig, options: AddServerOptions): boolean {
  let changed = false;
  if (existing.transport !== options.transport) {
    existing.transport = options.transport;
    changed = true;
  }
  if (options.url !== undefined && existing.url !== options.url) {
    existing.url = options.url;
    changed = true;
  }
  return changed;
}

function updateDefaultServer(registry: MCPRegistry, defaultId: string): boolean {
  let changed = false;
  for (const server of registry.servers) {
    const shouldBeDefault = server.id === defaultId;
    if ((server.default ?? false) !== shouldBeDefault) {
      server.default = shouldBeDefault;
      changed = true;
    }
  }
  return changed;
}

async function writeRegistry(registryPath: string, registry: MCPRegistry) {
  const serialised = `${JSON.stringify(registry, null, 2)}\n`;
  await fs.writeFile(registryPath, serialised, "utf8");
}
