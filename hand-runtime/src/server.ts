import express from 'express';
import cors from 'cors';
import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { exec as execCallback } from 'node:child_process';
import { promisify } from 'node:util';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';

const exec = promisify(execCallback);

const server = new McpServer({
  name: 'aos-hand',
  version: '0.1.0',
});

type HandRole = 'viewer' | 'editor' | 'operator' | 'admin';

interface TokenInfo {
  token: string;
  roles: HandRole[];
  label?: string;
}

class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

const rolePermissions: Record<HandRole, { allowTools: 'all' | string[] }> = {
  viewer: {
    allowTools: ['fs.read', 'http.fetch'],
  },
  editor: {
    allowTools: ['fs.read', 'http.fetch', 'fs.write'],
  },
  operator: {
    allowTools: ['fs.read', 'http.fetch', 'fs.write', 'shell.exec'],
  },
  admin: {
    allowTools: 'all',
  },
};

const validRoles = new Set<HandRole>(['viewer', 'editor', 'operator', 'admin']);

function parseTokenConfig(envValue: string | undefined): Map<string, TokenInfo> {
  const result = new Map<string, TokenInfo>();
  if (!envValue) {
    console.warn('[Hand MCP] 未配置 HAND_API_TOKENS，默认启用 hand-dev:admin (仅供本地调试)。');
    result.set('hand-dev', { token: 'hand-dev', roles: ['admin'], label: 'dev-fallback' });
    return result;
  }

  for (const raw of envValue.split(',')) {
    const entry = raw.trim();
    if (!entry) continue;
    const [tokenPart, roleAndLabel = ''] = entry.split(':');
    if (!tokenPart) continue;
    const [roleSegment, label] = roleAndLabel.split('@');
    const roles = roleSegment
      .split('|')
      .map((role) => role.trim())
      .filter((role): role is HandRole => validRoles.has(role as HandRole));

    if (roles.length === 0) {
      console.warn(`[Hand MCP] 跳过 token ${tokenPart}，未提供有效角色。`);
      continue;
    }

    result.set(tokenPart, {
      token: tokenPart,
      roles,
      label: label?.trim() || undefined,
    });
  }

  if (result.size === 0) {
    console.warn('[Hand MCP] HAND_API_TOKENS 未解析出有效条目，默认启用 hand-dev:admin (仅供本地调试)。');
    result.set('hand-dev', { token: 'hand-dev', roles: ['admin'], label: 'dev-fallback' });
  }

  return result;
}

const tokenRegistry = parseTokenConfig(process.env.HAND_API_TOKENS);

function authenticate(req: express.Request): TokenInfo {
  const header = req.headers['authorization'];
  let token: string | undefined;
  if (typeof header === 'string' && header.toLowerCase().startsWith('bearer ')) {
    token = header.slice(7).trim();
  }

  if (!token) {
    const headerToken = req.headers['x-api-token'];
    if (typeof headerToken === 'string') {
      token = headerToken.trim();
    }
  }

  if (!token) {
    throw new HttpError(401, '缺少 Authorization Bearer 或 X-API-Token');
  }

  const info = tokenRegistry.get(token);
  if (!info) {
    throw new HttpError(401, 'Token 无效或没有访问权限');
  }
  return info;
}

function isToolAllowed(roles: HandRole[], tool: string): boolean {
  return roles.some((role) => {
    const rule = rolePermissions[role];
    if (!rule) return false;
    return rule.allowTools === 'all' || rule.allowTools.includes(tool);
  });
}

function enforceRequestPermissions(auth: TokenInfo, payload: unknown) {
  if (!payload || typeof payload !== 'object') return;
  const request = payload as { method?: string; params?: any };
  if (request.method === 'tools/call') {
    const toolName = request.params?.name;
    if (typeof toolName === 'string' && !isToolAllowed(auth.roles, toolName)) {
      throw new HttpError(403, `当前角色无权调用工具 ${toolName}`);
    }
  }
}

const projectRoot = process.env.HAND_WORKSPACE || process.cwd();

const resolvePath = (p: string) => {
  const target = path.resolve(projectRoot, p);
  if (!target.startsWith(path.resolve(projectRoot))) {
    throw new Error('Path is outside of workspace');
  }
  return target;
};

server.tool(
  'fs.read',
  {
    path: z.string(),
    encoding: z.enum(['utf-8', 'base64']).optional(),
  },
  async ({ path: filePath, encoding }) => {
    const resolved = resolvePath(filePath);
    const data = await fs.readFile(resolved, encoding === 'base64' ? undefined : 'utf-8');
    const text = typeof data === 'string' ? data : data.toString('utf-8');
    return {
      content: [
        {
          type: 'text',
          text: encoding === 'base64' ? Buffer.from(text, 'utf-8').toString('base64') : text,
        },
      ],
    };
  },
);

server.tool(
  'fs.write',
  {
    path: z.string(),
    content: z.string(),
    encoding: z.enum(['utf-8', 'base64']).optional(),
  },
  async ({ path: filePath, content, encoding }) => {
    const resolved = resolvePath(filePath);
    const buffer = encoding === 'base64' ? Buffer.from(content, 'base64') : Buffer.from(content, 'utf-8');
    await fs.writeFile(resolved, buffer);
    return {
      content: [
        { type: 'text', text: `Wrote ${buffer.length} bytes to ${filePath}` },
      ],
    };
  },
);

server.tool(
  'shell.exec',
  {
    command: z.string(),
    cwd: z.string().optional(),
    timeoutMs: z.number().int().positive().max(120_000).optional(),
  },
  async ({ command, cwd, timeoutMs }) => {
    const execCwd = cwd ? resolvePath(cwd) : projectRoot;
    const result = await exec(command, { cwd: execCwd, timeout: timeoutMs ?? 60_000 });
    return {
      content: [
        { type: 'text', text: result.stdout ?? '' },
        ...(result.stderr ? [{ type: 'text' as const, text: `stderr:\n${result.stderr}` }] : []),
      ],
    };
  },
);

server.tool(
  'http.fetch',
  {
    url: z.string().url(),
    method: z.enum(['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD']).optional(),
    headers: z.record(z.string()).optional(),
    body: z.string().optional(),
  },
  async ({ url, method, headers, body }) => {
    const response = await fetch(url, {
      method,
      headers,
      body,
    });
    const text = await response.text();
    return {
      content: [
        { type: 'text', text: text },
      ],
      isError: !response.ok,
    };
  },
);

const app = express();
app.use(express.json({ limit: '2mb' }));
app.use(cors({
  origin: '*',
  exposedHeaders: ['Mcp-Session-Id'],
  allowedHeaders: ['Content-Type', 'mcp-session-id', 'authorization', 'x-api-token'],
}));

interface SessionEntry {
  transport: StreamableHTTPServerTransport;
  auth: TokenInfo;
  createdAt: number;
  lastSeenAt: number;
}

const sessions = new Map<string, SessionEntry>();

app.post('/mcp', async (req, res) => {
  try {
    const sessionId = req.headers['mcp-session-id'] as string | undefined;
    let transport: StreamableHTTPServerTransport;
    let auth: TokenInfo;

    if (sessionId) {
      const existing = sessions.get(sessionId);
      if (!existing) {
        throw new HttpError(400, 'Session ID 无效或已过期');
      }
      auth = authenticate(req);
      if (auth.token !== existing.auth.token) {
        throw new HttpError(403, '会话 Token 与创建时不一致');
      }
      enforceRequestPermissions(auth, req.body);
      existing.lastSeenAt = Date.now();
      transport = existing.transport;
    } else {
      if (!isInitializeRequest(req.body)) {
        throw new HttpError(400, '缺少会话 ID 且不是初始化请求');
      }
      auth = authenticate(req);
      enforceRequestPermissions(auth, req.body);
      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (id) => {
          sessions.set(id, {
            transport,
            auth,
            createdAt: Date.now(),
            lastSeenAt: Date.now(),
          });
        },
      });
      transport.onclose = () => {
        if (transport.sessionId) {
          sessions.delete(transport.sessionId);
        }
      };
      await server.connect(transport);
    }

    await transport.handleRequest(req, res, req.body);
  } catch (error) {
    if (error instanceof HttpError) {
      res.status(error.status).json({
        jsonrpc: '2.0',
        error: {
          code: -32000,
          message: error.message,
        },
        id: null,
      });
      return;
    }
    console.error('[Hand MCP] 处理请求失败', error);
    res.status(500).json({
      jsonrpc: '2.0',
      error: {
        code: -32603,
        message: 'Internal server error',
      },
      id: null,
    });
  }
});

const handleSessionRequest = async (req: express.Request, res: express.Response) => {
  try {
    const sessionId = req.headers['mcp-session-id'] as string | undefined;
    if (!sessionId) {
      throw new HttpError(400, '缺少会话 ID');
    }
    const entry = sessions.get(sessionId);
    if (!entry) {
      throw new HttpError(400, 'Session ID 无效或已过期');
    }
    const auth = authenticate(req);
    if (auth.token !== entry.auth.token) {
      throw new HttpError(403, '会话 Token 与创建时不一致');
    }
    entry.lastSeenAt = Date.now();
    await entry.transport.handleRequest(req, res);
  } catch (error) {
    if (error instanceof HttpError) {
      res.status(error.status).json({
        jsonrpc: '2.0',
        error: {
          code: -32000,
          message: error.message,
        },
        id: null,
      });
      return;
    }
    console.error('[Hand MCP] 处理会话请求失败', error);
    res.status(500).json({
      jsonrpc: '2.0',
      error: {
        code: -32603,
        message: 'Internal server error',
      },
      id: null,
    });
  }
};

app.get('/mcp', handleSessionRequest);
app.delete('/mcp', handleSessionRequest);

const port = Number(process.env.PORT || 3333);
app.listen(port, () => {
  console.log(`AOS Hand MCP server listening on http://localhost:${port}/mcp`);
});
