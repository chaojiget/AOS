import { Module } from "@nestjs/common";
import { RunsModule } from "../runs/runs.module";
import { AgentController } from "./agent.controller";

@Module({
  imports: [RunsModule],
  controllers: [AgentController],
})
export class AgentModule {}
