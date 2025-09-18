import { Body, Controller, Post } from "@nestjs/common";
import { RunsService } from "../runs/runs.service";

@Controller("agent")
export class AgentController {
  constructor(private readonly runs: RunsService) {}

  @Post("start")
  async startRun(@Body() body: any) {
    return this.runs.startRun(body ?? {});
  }
}
