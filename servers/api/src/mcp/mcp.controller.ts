import { BadRequestException, Body, Controller, Post } from "@nestjs/common";
import { McpService, type RegisterMcpPayload } from "./mcp.service";

type Transport = RegisterMcpPayload["transport"];

function parseTransport(value: unknown): Transport {
  if (value === "http" || value === "ws" || value === "stdio") {
    return value;
  }
  throw new BadRequestException("transport must be one of http, ws, stdio");
}

@Controller("mcp")
export class McpController {
  constructor(private readonly service: McpService) {}

  @Post("register")
  async register(@Body() body: any) {
    if (!body || typeof body !== "object") {
      throw new BadRequestException("request body is required");
    }
    const name =
      typeof body.name === "string" && body.name.trim().length > 0 ? body.name.trim() : null;
    if (!name) {
      throw new BadRequestException("name is required");
    }
    const transport = parseTransport(body.transport);
    const baseUrl = typeof body.baseUrl === "string" ? body.baseUrl.trim() : undefined;
    const enabled = typeof body.enabled === "boolean" ? body.enabled : undefined;
    const id =
      typeof body.id === "string" && body.id.trim().length > 0 ? body.id.trim() : undefined;
    const auth =
      body.auth && typeof body.auth === "object" ? (body.auth as Record<string, unknown>) : null;
    const metadata =
      body.metadata && typeof body.metadata === "object"
        ? (body.metadata as Record<string, unknown>)
        : null;

    const payload: RegisterMcpPayload = {
      id,
      name,
      transport,
      baseUrl,
      enabled,
      auth,
      metadata,
    };

    const config = await this.service.register(payload);
    return { config };
  }
}
