import "reflect-metadata";
import { Module } from "@nestjs/common";
import { ApiConfigModule } from "./config/api-config.module";
import { DatabaseModule } from "./database/database.module";
import { RunsModule } from "./runs/runs.module";
import { AgentModule } from "./agent/agent.module";
import { SkillsModule } from "./skills/skills.module";
import { McpModule } from "./mcp/mcp.module";
import { HealthModule } from "./health/health.module";

@Module({
  imports: [
    ApiConfigModule,
    DatabaseModule,
    RunsModule,
    AgentModule,
    SkillsModule,
    McpModule,
    HealthModule,
  ],
})
export class AppModule {}
