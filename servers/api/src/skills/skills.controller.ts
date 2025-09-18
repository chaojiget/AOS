import {
  BadRequestException,
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
} from "@nestjs/common";
import { SkillsService } from "./skills.service";

interface SkillTogglePayload {
  enabled: boolean;
}

@Controller("skills")
export class SkillsController {
  constructor(private readonly skills: SkillsService) {}

  @Get()
  async listSkills() {
    const skills = await this.skills.list();
    return { skills };
  }

  @Post(":id/enable")
  async enableSkill(@Param("id") id: string, @Body() body: SkillTogglePayload) {
    if (!id || id.trim().length === 0) {
      throw new BadRequestException("skill id is required");
    }
    if (typeof body?.enabled !== "boolean") {
      throw new BadRequestException("enabled flag is required");
    }
    try {
      const skill = await this.skills.setEnabled(id, body.enabled);
      const skills = await this.skills.list();
      return { skill, skills };
    } catch (error) {
      if (this.skills.isNotFound(error)) {
        throw new NotFoundException(`skill ${id} not found`);
      }
      throw error;
    }
  }

  @Post("analyze")
  async analyzeSkills() {
    return { accepted: true };
  }
}
