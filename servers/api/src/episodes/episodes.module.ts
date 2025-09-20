import { Module } from "@nestjs/common";
import { RunsModule } from "../runs/runs.module";
import { ApiConfigModule } from "../config/api-config.module";
import { EpisodesController } from "./episodes.controller";
import { EpisodesService } from "./episodes.service";

@Module({
  imports: [ApiConfigModule, RunsModule],
  controllers: [EpisodesController],
  providers: [EpisodesService],
  exports: [EpisodesService],
})
export class EpisodesModule {}
