import { Router } from 'express';
import { randomUUID } from 'crypto';
import {
  McpCallRequest,
  McpServerConfig,
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

mcpRoutes.get('/registry', requireAuth('mcp.registry.read'), (req, res) => {
  const auth = getAuthContext(req)!;
  const services = mcpRegistry
    .list()
    .filter((service) => serviceReadableByRole(auth.role, service));
  res.json({ services });
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
    res.status(500).json({
      error: error instanceof Error ? error.message : 'MCP 调用失败',
    });
  }
});

mcpRoutes.get('/sandbox/scripts', requireAuth('mcp.sandbox.read'), (_req, res) => {
  res.json({ scripts: mcpSandbox.list() });
});

mcpRoutes.post('/sandbox/scripts', requireAuth('mcp.sandbox.write'), async (req, res) => {
  const auth = getAuthContext(req)!;
  const { name, entryFile, description, scheduleMs, env } = req.body as Partial<SandboxScriptDefinition> & { env?: Record<string, string> };
  if (!name || !entryFile) {
    return res.status(400).json({ error: 'name 与 entryFile 为必填项' });
  }
  const id = randomUUID();
  const envConfig = parseEnv(env);
  const definition: SandboxScriptDefinition = {
    id,
    name,
    entryFile,
    description,
    scheduleMs,
    env: envConfig,
  };
  try {
    const registered = await mcpSandbox.register(definition);

    await auditFromAuth(auth, 'sandbox.script.create', `sandbox_script:${registered.id}`, {
      name: registered.name,
      scheduleMs: registered.scheduleMs ?? null,
    });

    res.status(201).json({ script: registered });
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
    const updates = req.body as Partial<SandboxScriptDefinition>;
    const envConfig = updates.env !== undefined ? parseEnv(updates.env) : existing.env;
    const definition: SandboxScriptDefinition = {
      ...existing,
      ...updates,
      scheduleMs: typeof updates.scheduleMs === 'number' ? updates.scheduleMs : existing.scheduleMs,
      entryFile: updates.entryFile ?? existing.entryFile,
      env: envConfig,
    };
    const registered = await mcpSandbox.register(definition);

    await auditFromAuth(auth, 'sandbox.script.update', `sandbox_script:${registered.id}`, {
      name: registered.name,
      scheduleMs: registered.scheduleMs ?? null,
    });

    res.json({ script: registered });
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
