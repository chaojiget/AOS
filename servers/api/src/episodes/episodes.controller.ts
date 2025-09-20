import { Body, Controller, Get, Param, Post, Query } from "@nestjs/common";
import { EpisodesService } from "./episodes.service";

@Controller("episodes")
export class EpisodesController {
  constructor(private readonly episodes: EpisodesService) {}

  @Get()
  listEpisodes(
    @Query("page") page?: string,
    @Query("page_size") pageSize?: string,
  ) {
    return this.episodes.listEpisodes({ page, pageSize });
  }

  @Get(":traceId")
  getEpisode(@Param("traceId") traceId: string) {
    return this.episodes.getEpisode(traceId);
  }

  @Post(":traceId/replay")
  replayEpisode(@Param("traceId") traceId: string, @Body() payload: any) {
    return this.episodes.replayEpisode(traceId, payload);
  }
}
