import { Module } from "@nestjs/common";
import { SkillsController } from "./skills.controller";
import { SkillsService } from "./skills.service";

@Module({
  providers: [SkillsService],
  controllers: [SkillsController],
})
export class SkillsModule {}
