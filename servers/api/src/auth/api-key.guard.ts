import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import type { Request } from "express";
import { ApiConfigService } from "../config/api-config.service";

function extractBearerToken(value: string | string[] | undefined): string | null {
  if (!value) {
    return null;
  }
  const header = Array.isArray(value) ? value[0] : value;
  if (!header) {
    return null;
  }
  const trimmed = header.trim();
  if (trimmed.toLowerCase().startsWith("bearer ")) {
    return trimmed.slice("bearer ".length).trim();
  }
  return trimmed.length > 0 ? trimmed : null;
}

@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(@Inject(ApiConfigService) private readonly config: ApiConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const expected = this.config.apiKey;
    if (!expected) {
      return true;
    }
    const request = context.switchToHttp().getRequest<Request>();
    const provided = extractBearerToken(request.headers["authorization"]);
    if (!provided || provided !== expected) {
      throw new UnauthorizedException("invalid or missing API key");
    }
    return true;
  }
}
