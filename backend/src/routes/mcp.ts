import { Router } from 'express';
import { promises as fs } from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import {
  McpCallRequest,
  McpServerConfig,
  SandboxEnvironmentDefinition,
  SandboxRunTrigger,
  SandboxScriptDefinition,
} from '../mcp/types';
import { mcpRegistry } from '../mcp/registry';
import { mcpGateway } from '../mcp/gateway';
import { mcpSandbox } from '../mcp/sandbox';
import { requireAuth, getAuthContext } from '../auth/middleware';
import { Role, normalizeRole } from '../auth/roles';
import { auditFromAuth } from '../audit/logger';
import { loadAgentRunsForScript } from '../mcp/storage';
import { getTelemetryExporter } from '../telemetry/provider';
import {
  TelemetryInitializationError,
  TelemetryStorageError,
} from '../telemetry/nats-exporter';
import { mcpMonitor, ServicePolicy } from '../mcp/monitor';

export const mcpRoutes = Router();
const telemetryExporter = getTelemetryExporter();

const parseEnv = (input: unknown): Record<string, string> | undefined => {
  if (input == null) return undefined;
  if (typeof input !== 'object') {
    throw new Error('env 必须是键值对对象');
  }
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (typeof value !== 'string') {
      throw new Error('env 的值必须是字符串');
    }
    env[key] = value;
  }
  return env;
};

const sandboxBaseDir = path.resolve(process.env.SANDBOX_SCRIPTS_DIR ?? path.join(process.cwd(), 'sandbox-scripts'));

const ensureSandboxBaseDir = async () => {
  await fs.mkdir(sandboxBaseDir, { recursive: true });
};

const slugify = (value: string) => {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return normalized || `script-${Date.now().toString(36)}`;
};

const resolveEntryFile = async (name: string, entryFile?: string | null): Promise<string> => {
  await ensureSandboxBaseDir();
  if (entryFile && entryFile.trim()) {
    const trimmed = entryFile.trim();
    if (path.isAbsolute(trimmed)) {
      return trimmed;
    }
    const resolved = path.resolve(sandboxBaseDir, trimmed);
    if (!resolved.startsWith(sandboxBaseDir)) {
      throw new Error('入口文件路径不合法');
    }
    return resolved;
  }
  const filename = `${slugify(name)}.mjs`;
  return path.join(sandboxBaseDir, filename);
};

const ensureScriptFile = async (filePath: string, content?: string) => {
  if (content != null) {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, content, 'utf-8');
    return;
  }
  try {
    await fs.access(filePath);
  } catch (error) {
    throw new Error('入口文件不存在，请提供脚本内容或填写正确路径');
  }
};

const parseAllowedRoles = (input: unknown): Role[] | undefined => {
  if (input == null) return undefined;
  if (!Array.isArray(input)) {
    throw new Error('allowedRoles 必须是字符串数组');
  }
  const roles = input.map((value) => {
    if (typeof value !== 'string') {
      throw new Error('allowedRoles 必须是字符串数组');
    }
    return normalizeRole(value);
  });
  return Array.from(new Set(roles));
};

const serviceReadableByRole = (role: Role, service: McpServerConfig): boolean => {
  if (!service.allowedRoles || service.allowedRoles.length === 0) return true;
  if (role === 'owner' || role === 'admin') return true;
  return service.allowedRoles.includes(role);
};

const ensureServiceWritable = (role: Role, service: McpServerConfig) => {
  if (role === 'owner' || role === 'admin') return;
  if (service.allowedRoles && service.allowedRoles.length > 0 && !service.allowedRoles.includes(role)) {
    throw Object.assign(new Error('当前角色无权管理该服务'), { statusCode: 403 });
  }
};

const handleTelemetryError = (res: any, error: unknown) => {
  if (error instanceof TelemetryInitializationError) {
    res.status(503).json({ error: '日志服务未初始化' });
    return true;
  }
  if (error instanceof TelemetryStorageError) {
    res.status(500).json({ error: '日志服务写入失败' });
    return true;
  }
  return false;
};

mcpRoutes.get('/sandbox/environments', requireAuth('mcp.sandbox.read'), async (_req, res) => {
  await mcpSandbox.ensureDefaultEnvironment();
  res.json({ environments: mcpSandbox.listEnvironments() });
});

mcpRoutes.post('/sandbox/environments', requireAuth('mcp.sandbox.write'), async (req, res) => {
  const auth = getAuthContext(req)!;
  const { name, description, variables } = req.body as Partial<SandboxEnvironmentDefinition> & {
    variables?: Record<string, unknown>;
  };

  if (!name || typeof name !== 'string' || !name.trim()) {
    return res.status(400).json({ error: '名称为必填项' });
  }

  try {
    const parsedVariables = parseEnv(variables ?? {}) ?? {};
    const environment = await mcpSandbox.registerEnvironment(
      {
        id: randomUUID(),
        name: name.trim(),
        description: description?.toString().trim() || undefined,
        variables: parsedVariables,
      },
    );

    await auditFromAuth(auth, 'sandbox.environment.create', `sandbox_environment:${environment.id}`, {
      name: environment.name,
      variableCount: Object.keys(environment.variables ?? {}).length,
    });

    res.status(201).json({ environment });
  } catch (error) {
    const message = error instanceof Error ? error.message : '创建虚拟环境失败';
    res.status(400).json({ error: message });
  }
});

mcpRoutes.patch('/sandbox/environments/:id', requireAuth('mcp.sandbox.write'), async (req, res) => {
  const auth = getAuthContext(req)!;
  const existing = mcpSandbox.getEnvironment(req.params.id);
  if (!existing) {
    return res.status(404).json({ error: '未找到虚拟环境' });
  }

  try {
    const { name, description, variables } = req.body as Partial<SandboxEnvironmentDefinition> & {
      variables?: Record<string, unknown>;
    };
    const parsedVariables =
      variables !== undefined ? parseEnv(variables ?? {}) ?? {} : existing.variables ?? {};

    const environment = await mcpSandbox.registerEnvironment(
      {
        ...existing,
        name: typeof name === 'string' && name.trim() ? name.trim() : existing.name,
        description:
          description !== undefined
            ? (description == null || description === '')
              ? undefined
              : description.toString().trim()
            : existing.description,
        variables: parsedVariables,
      },
    );

    await auditFromAuth(auth, 'sandbox.environment.update', `sandbox_environment:${environment.id}`, {
      name: environment.name,
      variableCount: Object.keys(environment.variables ?? {}).length,
    });

    res.json({ environment });
  } catch (error) {
    const message = error instanceof Error ? error.message : '更新虚拟环境失败';
    res.status(400).json({ error: message });
  }
});

mcpRoutes.delete('/sandbox/environments/:id', requireAuth('mcp.sandbox.write'), async (req, res) => {
  const auth = getAuthContext(req)!;
  try {
    const removed = await mcpSandbox.removeEnvironment(req.params.id);
    if (!removed) {
      return res.status(404).json({ error: '未找到虚拟环境' });
    }

    await auditFromAuth(auth, 'sandbox.environment.delete', `sandbox_environment:${req.params.id}`);

    res.status(204).end();
  } catch (error) {
    const message = error instanceof Error ? error.message : '删除虚拟环境失败';
    res.status(400).json({ error: message });
  }
});

mcpRoutes.get('/registry', requireAuth('mcp.registry.read'), (req, res) => {
  const auth = getAuthContext(req)!;
  const services = mcpRegistry
    .list()
    .filter((service) => serviceReadableByRole(auth.role, service));
  const statusMap = new Map(mcpMonitor.listStatuses().map((status) => [status.name, status]));
  const enriched = services.map((service) => ({
    ...service,
    status: statusMap.get(service.name) ?? mcpMonitor.getStatus(service.name),
  }));
  res.json({ services: enriched });
});

mcpRoutes.post('/registry', requireAuth('mcp.registry.write'), async (req, res) => {
  const auth = getAuthContext(req)!;
  const { name, baseUrl, description, capabilities, authToken, timeoutMs, allowedRoles } = req.body as McpServerConfig & {
    allowedRoles?: Role[] | string[];
  };
  if (!name || !baseUrl || !Array.isArray(capabilities)) {
    return res.status(400).json({ error: 'name/baseUrl/capabilities 为必填项' });
  }

  try {
    const parsedAllowedRoles = parseAllowedRoles(allowedRoles);
    const registered = await mcpRegistry.register({
      name,
      baseUrl,
      description,
      capabilities,
      authToken,
      timeoutMs,
      allowedRoles: parsedAllowedRoles,
    });

    await auditFromAuth(auth, 'mcp.registry.create', `mcp_registry:${registered.name}`, {
      name: registered.name,
      baseUrl: registered.baseUrl,
      allowedRoles: registered.allowedRoles ?? null,
    });

    mcpMonitor.register(registered);

    res.status(201).json({ service: registered });
  } catch (error) {
    const message = error instanceof Error ? error.message : '注册服务失败';
    const status = (error as any)?.statusCode === 403 ? 403 : 500;
    res.status(status).json({ error: message });
  }
});

mcpRoutes.patch('/registry/:name', requireAuth('mcp.registry.write'), async (req, res) => {
  const auth = getAuthContext(req)!;
  const existing = mcpRegistry.get(req.params.name);
  if (!existing) {
    return res.status(404).json({ error: '未找到对应服务' });
  }

  try {
    ensureServiceWritable(auth.role, existing);
    const updates = req.body as Partial<McpServerConfig> & { allowedRoles?: Role[] | string[] };
    const parsedAllowedRoles = updates.allowedRoles ? parseAllowedRoles(updates.allowedRoles) : existing.allowedRoles;
    const payload: McpServerConfig = {
      ...existing,
      ...updates,
      capabilities: Array.isArray(updates.capabilities) ? updates.capabilities : existing.capabilities,
      allowedRoles: parsedAllowedRoles,
    };
    const registered = await mcpRegistry.register(payload);

    await auditFromAuth(auth, 'mcp.registry.update', `mcp_registry:${registered.name}`, {
      baseUrl: registered.baseUrl,
      allowedRoles: registered.allowedRoles ?? null,
    });

    mcpMonitor.register(registered);

    res.json({ service: registered });
  } catch (error) {
    const message = error instanceof Error ? error.message : '更新服务失败';
    const status = (error as any)?.statusCode === 403 ? 403 : 500;
    res.status(status).json({ error: message });
  }
});

mcpRoutes.delete('/registry/:name', requireAuth('mcp.registry.write'), async (req, res) => {
  const auth = getAuthContext(req)!;
  const existing = mcpRegistry.get(req.params.name);
  if (!existing) {
    return res.status(404).json({ error: '未找到对应服务' });
  }

  try {
    ensureServiceWritable(auth.role, existing);
    const existed = await mcpRegistry.unregister(req.params.name);
    if (!existed) {
      return res.status(404).json({ error: '未找到对应服务' });
    }

    await auditFromAuth(auth, 'mcp.registry.delete', `mcp_registry:${req.params.name}`);

    mcpMonitor.unregister(req.params.name);

    res.status(204).end();
  } catch (error) {
    const message = error instanceof Error ? error.message : '删除服务失败';
    const status = (error as any)?.statusCode === 403 ? 403 : 500;
    res.status(status).json({ error: message });
  }
});

mcpRoutes.post('/call', requireAuth('mcp.registry.call'), async (req, res) => {
  const auth = getAuthContext(req)!;
  try {
    const payload = req.body as McpCallRequest;
    if (!payload.server || !payload.tool) {
      return res.status(400).json({ error: 'server 与 tool 为必填项' });
    }
    const service = mcpRegistry.get(payload.server);
    if (!service) {
      return res.status(404).json({ error: '未找到对应服务' });
    }
    if (!serviceReadableByRole(auth.role, service)) {
      return res.status(403).json({ error: '权限不足' });
    }

    const result = await mcpGateway.call(payload);

    await auditFromAuth(auth, 'mcp.registry.call', `mcp_registry:${payload.server}`, {
      tool: payload.tool,
      capability: payload.capability ?? null,
    });

    res.json(result);
  } catch (error) {
    const code = (error as any)?.code;
    const statusCode = code === 'quota_exceeded' ? 429 : code === 'circuit_open' ? 503 : 500;
    res.status(statusCode).json({
      error: error instanceof Error ? error.message : 'MCP 调用失败',
      code: typeof code === 'string' ? code : undefined,
    });
  }
});

const parsePolicyNumber = (value: unknown, minimum?: number): number | undefined => {
  if (value == null || value === '') return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error('策略配置必须为有效数字');
  }
  if (minimum != null && parsed < minimum) {
    throw new Error(`策略配置需大于等于 ${minimum}`);
  }
  return parsed;
};

mcpRoutes.patch('/registry/:name/policies', requireAuth('mcp.registry.write'), async (req, res) => {
  const auth = getAuthContext(req)!;
  const service = mcpRegistry.get(req.params.name);
  if (!service) {
    return res.status(404).json({ error: '未找到对应服务' });
  }

  try {
    ensureServiceWritable(auth.role, service);
    const body = req.body as {
      quota?: { limitPerMinute?: unknown; burstMultiplier?: unknown };
      circuitBreaker?: { failureThreshold?: unknown; cooldownSeconds?: unknown; minimumSamples?: unknown };
    };

    const quota = body.quota
      ? {
          limitPerMinute: parsePolicyNumber(body.quota.limitPerMinute, 1),
          burstMultiplier: parsePolicyNumber(body.quota.burstMultiplier, 1) ?? 1.2,
        }
      : undefined;

    const circuit = body.circuitBreaker
      ? {
          failureThreshold: parsePolicyNumber(body.circuitBreaker.failureThreshold, 1) ?? 3,
          cooldownSeconds: parsePolicyNumber(body.circuitBreaker.cooldownSeconds, 1) ?? 60,
          minimumSamples: parsePolicyNumber(body.circuitBreaker.minimumSamples, 1) ?? 5,
        }
      : undefined;

    const policy: ServicePolicy = {
      quota,
      circuitBreaker: circuit,
    };

    mcpMonitor.setPolicy(service.name, policy);
    await mcpMonitor.persistPolicy(service.name);

    await auditFromAuth(auth, 'mcp.registry.policy.update', `mcp_registry:${service.name}`, {
      quota,
      circuit,
    });

    res.json({ status: mcpMonitor.getStatus(service.name) });
  } catch (error) {
    const message = error instanceof Error ? error.message : '更新策略失败';
    const status = (error as any)?.statusCode === 403 ? 403 : 400;
    res.status(status).json({ error: message });
  }
});

mcpRoutes.post('/registry/:name/health-check', requireAuth('mcp.registry.read'), async (req, res) => {
  const auth = getAuthContext(req)!;
  const service = mcpRegistry.get(req.params.name);
  if (!service) {
    return res.status(404).json({ error: '未找到对应服务' });
  }
  if (!serviceReadableByRole(auth.role, service)) {
    return res.status(403).json({ error: '权限不足' });
  }

  try {
    const probe = await mcpMonitor.runHealthCheck(service);
    await auditFromAuth(auth, 'mcp.registry.health_check', `mcp_registry:${service.name}`, probe);
    res.json({ status: mcpMonitor.getStatus(service.name) });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : '健康检查失败' });
  }
});

mcpRoutes.get('/sandbox/scripts', requireAuth('mcp.sandbox.read'), (_req, res) => {
  res.json({ scripts: mcpSandbox.list() });
});

mcpRoutes.post('/sandbox/scripts', requireAuth('mcp.sandbox.write'), async (req, res) => {
  const auth = getAuthContext(req)!;
  const {
    name,
    entryFile,
    description,
    scheduleMs,
    env,
    environmentId,
    content,
  } = req.body as Partial<SandboxScriptDefinition> & {
    env?: Record<string, unknown>;
    content?: string;
  };
  if (!name) {
    return res.status(400).json({ error: 'name 为必填项' });
  }

  try {
    const entryPath = await resolveEntryFile(name, entryFile ?? null);
    await ensureScriptFile(entryPath, content);

    const id = randomUUID();
    const envConfig = parseEnv(env);
    const normalizedEnvironmentId =
      typeof environmentId === 'string' && environmentId.trim() ? environmentId.trim() : null;
    const definition: SandboxScriptDefinition = {
      id,
      name,
      entryFile: entryPath,
      description,
      scheduleMs,
      env: envConfig,
      environmentId: normalizedEnvironmentId,
    };

    const registered = await mcpSandbox.register(definition);
    const scriptResponse =
      mcpSandbox.list().find((item) => item.id === registered.id) ?? registered;

    await auditFromAuth(auth, 'sandbox.script.create', `sandbox_script:${registered.id}`, {
      name: registered.name,
      scheduleMs: registered.scheduleMs ?? null,
      environmentId: registered.environmentId ?? null,
    });

    res.status(201).json({ script: scriptResponse });
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : '注册脚本失败' });
  }
});

mcpRoutes.patch('/sandbox/scripts/:id', requireAuth('mcp.sandbox.write'), async (req, res) => {
  const auth = getAuthContext(req)!;
  const existing = mcpSandbox.get(req.params.id);
  if (!existing) {
    return res.status(404).json({ error: '未找到脚本' });
  }

  try {
    const updates = req.body as Partial<SandboxScriptDefinition> & {
      env?: Record<string, unknown>;
      content?: string;
    };
    const envConfig = updates.env !== undefined ? parseEnv(updates.env) : existing.env;
    const targetEntryFile = await resolveEntryFile(existing.name, updates.entryFile ?? existing.entryFile);
    await ensureScriptFile(targetEntryFile, updates.content);
    const normalizedEnvironmentId =
      updates.environmentId !== undefined
        ? typeof updates.environmentId === 'string' && updates.environmentId.trim()
          ? updates.environmentId.trim()
          : null
        : existing.environmentId ?? null;
    const definition: SandboxScriptDefinition = {
      ...existing,
      ...updates,
      scheduleMs: typeof updates.scheduleMs === 'number' ? updates.scheduleMs : existing.scheduleMs,
      entryFile: targetEntryFile,
      env: envConfig,
      environmentId: normalizedEnvironmentId,
    };
    const registered = await mcpSandbox.register(definition);
    const scriptResponse =
      mcpSandbox.list().find((item) => item.id === registered.id) ?? registered;

    await auditFromAuth(auth, 'sandbox.script.update', `sandbox_script:${registered.id}`, {
      name: registered.name,
      scheduleMs: registered.scheduleMs ?? null,
      environmentId: registered.environmentId ?? null,
    });

    res.json({ script: scriptResponse });
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : '更新脚本失败' });
  }
});

mcpRoutes.post('/sandbox/scripts/:id/run', requireAuth('mcp.sandbox.execute'), async (req, res) => {
  const auth = getAuthContext(req)!;
  try {
    const result = await mcpSandbox.run(req.params.id, {
      trigger: req.body?.trigger as SandboxRunTrigger | undefined ?? 'manual',
      actor: auth.subject,
    });

    await auditFromAuth(auth, 'sandbox.script.run', `sandbox_script:${req.params.id}`, {
      trigger: result.trigger,
      status: result.status,
      runId: result.runId,
    });

    res.json(result);
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : '执行脚本失败' });
  }
});

mcpRoutes.get('/sandbox/scripts/:id/runs', requireAuth('mcp.sandbox.read'), async (req, res) => {
  const limit = req.query.limit ? Number(req.query.limit) : 20;
  const runs = await loadAgentRunsForScript(req.params.id, Number.isNaN(limit) ? 20 : limit);
  res.json({ runs });
});

mcpRoutes.delete('/sandbox/scripts/:id', requireAuth('mcp.sandbox.write'), async (req, res) => {
  const auth = getAuthContext(req)!;
  try {
    const ok = await mcpSandbox.remove(req.params.id);
    if (!ok) {
      return res.status(404).json({ error: '未找到脚本' });
    }

    await auditFromAuth(auth, 'sandbox.script.delete', `sandbox_script:${req.params.id}`);

    res.status(204).end();
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : '删除脚本失败' });
  }
});

mcpRoutes.post('/logs/publish', requireAuth('mcp.logs.write'), async (req, res) => {
  const auth = getAuthContext(req)!;
  const { level = 'info', message, traceId, spanId, topic, attributes } = req.body as Record<string, any>;

  if (!message || typeof message !== 'string') {
    return res.status(400).json({ error: 'message 必须为字符串' });
  }

  try {
    await telemetryExporter.ensureReady();
    const mergedAttributes = {
      ...attributes,
      ...(topic ? { topic } : {}),
    };
    await telemetryExporter.logEvent(level, message, traceId, spanId, mergedAttributes);

    await auditFromAuth(auth, 'logs.publish', 'logs', {
      level,
      traceId: traceId ?? null,
      topic: topic ?? null,
    });

    res.json({ status: 'accepted', level });
  } catch (error) {
    if (handleTelemetryError(res, error)) {
      return;
    }
    console.error('[MCP] 日志写入失败', error);
    res.status(500).json({ error: '写入日志失败' });
  }
});

mcpRoutes.post('/logs/query', requireAuth('mcp.logs.read'), async (req, res) => {
  const { limit, level, after, before, traceId, topic } = req.body as {
    limit?: number;
    level?: string;
    after?: number;
    before?: number;
    traceId?: string;
    topic?: string;
  };

  try {
    await telemetryExporter.ensureReady();
    const logs = await telemetryExporter.getLogs(limit ?? 100, {
      level,
      after,
      before,
      traceId,
      topic,
    });

    res.json({
      logs,
      nextAfter: logs.length > 0 ? logs[0].timestamp : after ?? null,
    });
  } catch (error) {
    if (handleTelemetryError(res, error)) {
      return;
    }
    console.error('[MCP] 查询日志失败', error);
    res.status(500).json({ error: '查询日志失败' });
  }
});

mcpRoutes.post('/logs/subscribe', requireAuth('mcp.logs.subscribe'), async (req, res) => {
  const { after, before, limit, topic } = req.body as { after?: number; before?: number; limit?: number; topic?: string };

  try {
    await telemetryExporter.ensureReady();
    const logs = await telemetryExporter.getLogs(limit ?? 100, {
      after,
      before,
      topic,
    });

    res.json({
      logs,
      nextAfter: logs.length > 0 ? logs[0].timestamp : after ?? null,
    });
  } catch (error) {
    if (handleTelemetryError(res, error)) {
      return;
    }
    console.error('[MCP] 日志订阅轮询失败', error);
    res.status(500).json({ error: '获取日志失败' });
  }
});
