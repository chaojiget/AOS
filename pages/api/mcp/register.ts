import type { NextApiRequest, NextApiResponse } from "next";
import type { INestApplicationContext } from "@nestjs/common";
import { McpService } from "../../../servers/api/src/mcp/mcp.service";
import { AppModule } from "../../../servers/api/src/app.module";
import { NestFactory } from "@nestjs/core";
import { buildAuthHeaders, resolveApiBaseUrl } from "../run";

let localAppPromise: Promise<INestApplicationContext> | null = null;
async function getLocalApp(): Promise<INestApplicationContext> {
  if (!localAppPromise) {
    process.env.AOS_USE_IN_MEMORY_DB = process.env.AOS_USE_IN_MEMORY_DB ?? "1";
    localAppPromise = NestFactory.createApplicationContext(AppModule, { bufferLogs: true });
  }
  return localAppPromise;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: { message: "Method Not Allowed" } });
  }

  const payload = typeof req.body === "object" && req.body ? req.body : {};
  const apiBase = resolveApiBaseUrl();

  try {
    if (apiBase) {
      const response = await fetch(`${apiBase}/mcp/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...buildAuthHeaders() },
        body: JSON.stringify(payload),
      });
      const json = await response.json().catch(() => null);
      if (!response.ok || !json) {
        const message = (json as any)?.error?.message ?? `Upstream error (${response.status})`;
        return res.status(response.status).json({ error: { message } });
      }
      return res.status(200).json(json);
    }

    const app = await getLocalApp();
    const service = app.get(McpService);
    const config = await service.register(payload as any);
    return res.status(200).json({ config });
  } catch (error: any) {
    const message = error?.message ?? "Request failed";
    return res.status(500).json({ error: { message } });
  }
}
