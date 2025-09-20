export interface McpRegisterPayload {
  id?: string;
  name: string;
  transport: "http" | "ws" | "stdio";
  baseUrl?: string;
  enabled?: boolean;
  auth?: Record<string, unknown> | null;
  metadata?: Record<string, unknown> | null;
}

export interface McpConfigResponse {
  config: {
    id: string;
    name: string;
    transport: "http" | "ws" | "stdio";
    baseUrl?: string | null;
    enabled: boolean;
    updatedAt: string;
  };
}

function resolveUrl(path: string): string {
  return path.startsWith("/") ? path : `/${path}`;
}

export async function registerMcpEndpoint(payload: McpRegisterPayload): Promise<McpConfigResponse> {
  const response = await fetch(resolveUrl("/api/mcp/register"), {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    let message = `请求失败（${response.status}）`;
    try {
      const json = await response.json();
      if (json?.error?.message) message = json.error.message;
    } catch {}
    throw new Error(message);
  }
  return (await response.json()) as McpConfigResponse;
}
