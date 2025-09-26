import { McpCallRequest, McpCallResult } from './types';
import { mcpRegistry } from './registry';

export class McpGateway {
  async call(request: McpCallRequest): Promise<McpCallResult> {
    const config = mcpRegistry.get(request.server);
    if (!config) {
      throw new Error(`未找到名称为 ${request.server} 的 MCP 服务`);
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), config.timeoutMs ?? 30_000);
    const started = Date.now();

    try {
      const response = await fetch(`${config.baseUrl}/mcp/${request.tool}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(config.authToken ? { Authorization: `Bearer ${config.authToken}` } : {}),
        },
        body: JSON.stringify({ args: request.args ?? {}, capability: request.capability }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`MCP 调用失败(${response.status}): ${text}`);
      }

      const result = await response.json();
      return {
        server: request.server,
        tool: request.tool,
        durationMs: Date.now() - started,
        result,
      };
    } finally {
      clearTimeout(timeout);
    }
  }
}

export const mcpGateway = new McpGateway();
