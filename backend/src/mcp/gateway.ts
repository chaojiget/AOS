import { randomUUID } from 'crypto';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import {
  StreamableHTTPClientTransport,
  StreamableHTTPClientTransportOptions,
  StreamableHTTPError,
} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { McpCallRequest, McpCallResult } from './types';
import { mcpRegistry } from './registry';
import { logClient } from '../services/log-client';
import { mcpMonitor } from './monitor';

export class McpGateway {
  async call(request: McpCallRequest): Promise<McpCallResult> {
    const config = mcpRegistry.get(request.server);
    if (!config) {
      throw new Error(`未找到名称为 ${request.server} 的 MCP 服务`);
    }

    mcpMonitor.beforeCall(request.server);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), config.timeoutMs ?? 30_000);
    const started = Date.now();
    const callId = randomUUID();

    await logClient.write({
      level: 'info',
      message: `MCP 调用开始: ${request.server}/${request.tool}`,
      traceId: callId,
      topic: 'mcp.call.start',
      attributes: {
        server: request.server,
        tool: request.tool,
        capability: request.capability,
        argsPreview: request.args ? JSON.stringify(request.args).slice(0, 500) : undefined,
      },
    });

    const endpoint = this.resolveEndpoint(config.baseUrl);
    const headers: HeadersInit = {
      'Content-Type': 'application/json',
      ...(config.authToken ? { Authorization: `Bearer ${config.authToken}` } : {}),
    };

    const transportOptions: StreamableHTTPClientTransportOptions = {
      requestInit: {
        headers,
      },
    };

    const client = new Client({
      name: 'aos-backend',
      version: '0.1.0',
    });

    const transport = new StreamableHTTPClientTransport(endpoint, transportOptions);
    controller.signal.addEventListener('abort', () => {
      void transport.close();
    });

    try {
      await client.connect(transport);
      const result = await client.callTool({
        name: request.tool,
        arguments: request.args ?? {},
      });
      await logClient.write({
        level: 'info',
        message: `MCP 调用成功: ${request.server}/${request.tool}`,
        traceId: callId,
        topic: 'mcp.call.success',
        attributes: {
          server: request.server,
          tool: request.tool,
          capability: request.capability,
          durationMs: Date.now() - started,
          resultPreview: result ? JSON.stringify(result).slice(0, 500) : undefined,
        },
      });
      const duration = Date.now() - started;
      mcpMonitor.observeCall(request.server, {
        durationMs: duration,
        success: true,
      });
      return {
        server: request.server,
        tool: request.tool,
        durationMs: duration,
        result,
      };
    } catch (error) {
      const message = this.describeError(error);
      await logClient.write({
        level: 'error',
        message: `MCP 调用失败: ${request.server}/${request.tool}`,
        traceId: callId,
        topic: 'mcp.call.error',
        attributes: {
          server: request.server,
          tool: request.tool,
          capability: request.capability,
          durationMs: Date.now() - started,
          error: message,
          argsPreview: request.args ? JSON.stringify(request.args).slice(0, 500) : undefined,
        },
      });
      const duration = Date.now() - started;
      mcpMonitor.observeCall(request.server, {
        durationMs: duration,
        success: false,
        errorMessage: message,
      });
      throw error instanceof Error ? error : new Error(message);
    } finally {
      await client.close().catch(() => undefined);
      clearTimeout(timeout);
    }
  }

  private resolveEndpoint(baseUrl: string): URL {
    const endpoint = new URL(baseUrl);
    if (!/\/mcp\/?$/.test(endpoint.pathname)) {
      const path = endpoint.pathname.endsWith('/') ? `${endpoint.pathname}mcp` : `${endpoint.pathname}/mcp`;
      endpoint.pathname = path;
    }
    return endpoint;
  }

  private describeError(error: unknown): string {
    if (error instanceof StreamableHTTPError) {
      return `HTTP ${error.code ?? 'error'} ${error.message}`;
    }
    if (error instanceof Error) {
      return error.message;
    }
    return String(error);
  }
}

export const mcpGateway = new McpGateway();
