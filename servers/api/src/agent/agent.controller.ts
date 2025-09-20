import { Body, Controller, Post } from "@nestjs/common";
import { ApiConfigService } from "../config/api-config.service";
import { RunsService } from "../runs/runs.service";

@Controller("agent")
export class AgentController {
  constructor(
    private readonly runs: RunsService,
    private readonly config: ApiConfigService,
  ) {}

  @Post("start")
  async startRun(@Body() body: any) {
    const result = await this.runs.startRun(body ?? {});
    if (this.config.waitForRunCompletion) {
      await this.runs.awaitRunCompletion(result.runId).catch(() => undefined);
    }
    return result;
  }
}
