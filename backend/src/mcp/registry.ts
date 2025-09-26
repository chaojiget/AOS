import { McpServerConfig, McpCapability } from './types';
import { normalizeRole } from '../auth/roles';
import { deleteRegistryFromStorage, loadRegistryFromStorage, saveRegistryToStorage } from './storage';

export class McpRegistry {
  private readonly servers = new Map<string, McpServerConfig>();

  async hydrate(): Promise<void> {
    const records = await loadRegistryFromStorage();
    this.servers.clear();
    for (const record of records) {
      const sanitized = this.sanitize(record);
      this.servers.set(sanitized.name, sanitized);
    }
  }

  list(): McpServerConfig[] {
    return Array.from(this.servers.values());
  }

  get(name: string): McpServerConfig | undefined {
    return this.servers.get(name);
  }

  async register(config: McpServerConfig): Promise<McpServerConfig> {
    const sanitized = this.sanitize(config);
    await saveRegistryToStorage(sanitized);
    this.servers.set(sanitized.name, sanitized);
    return sanitized;
  }

  async unregister(name: string): Promise<boolean> {
    await deleteRegistryFromStorage(name);
    return this.servers.delete(name);
  }

  private sanitize(config: McpServerConfig): McpServerConfig {
    const capabilitySet = new Set<McpCapability>(['tools', 'files', 'secrets', 'events']);
    const capabilities = (config.capabilities ?? []).filter((cap): cap is McpCapability => capabilitySet.has(cap));
    const roleSet = new Set(config.allowedRoles?.map((role) => normalizeRole(role)) ?? []);
    return {
      ...config,
      capabilities,
      timeoutMs: config.timeoutMs ?? 30_000,
      allowedRoles: Array.from(roleSet),
    };
  }
}

export const mcpRegistry = new McpRegistry();
