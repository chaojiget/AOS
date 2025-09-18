import { Injectable } from "@nestjs/common";
import { join } from "node:path";

type AllowedOrigins = string[] | true;

function parseOrigins(raw: string | undefined): AllowedOrigins {
  if (!raw || raw.trim() === "" || raw.trim() === "*") {
    return true;
  }
  const entries = raw
    .split(",")
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
  return entries.length > 0 ? entries : true;
}

@Injectable()
export class ApiConfigService {
  private readonly portValue: number;
  private readonly dbPathValue: string;
  private readonly episodesDirValue: string;
  private readonly allowedOriginsValue: AllowedOrigins;
  private readonly apiKeyValue: string | null;

  constructor() {
    const env = process.env;
    this.portValue = Number(env.AOS_API_PORT ?? env.PORT ?? 3030);
    this.dbPathValue = env.AOS_DB_PATH ?? join(process.cwd(), "data", "aos.sqlite");
    this.episodesDirValue = env.AOS_EPISODES_DIR ?? join(process.cwd(), "episodes");
    this.allowedOriginsValue = parseOrigins(env.AOS_API_CORS);
    const key = env.AOS_API_KEY?.trim();
    this.apiKeyValue = key && key.length > 0 ? key : null;
  }

  get port(): number {
    return this.portValue;
  }

  get databasePath(): string {
    return this.dbPathValue;
  }

  get episodesDir(): string {
    return this.episodesDirValue;
  }

  get allowedOrigins(): AllowedOrigins {
    return this.allowedOriginsValue;
  }

  get apiKey(): string | null {
    return this.apiKeyValue;
  }
}
