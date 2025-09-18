import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Post,
} from "@nestjs/common";
import type { SkillRecord } from "../../../../packages/skills/storage";
import { SkillsService } from "./skills.service";

interface SkillMutationPayload {
  id: string;
  enabled: boolean;
}

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

  @Get("candidates")
  async listCandidates() {
    const candidates = await this.skills.listCandidates();
    return { candidates };
  }

  @Post()
  async mutateSkill(@Body() body: SkillMutationPayload) {
    const id = typeof body?.id === "string" ? body.id.trim() : "";
    const enabled = body?.enabled;
    if (!id) {
      throw new BadRequestException("id field is required");
    }
    if (typeof enabled !== "boolean") {
      throw new BadRequestException("enabled field is required");
    }
    try {
      const skill = await this.skills.setEnabled(id, enabled);
      const skills = await this.skills.list();
      return { skill, skills };
    } catch (error) {
      if (this.skills.isNotFound(error)) {
        throw new NotFoundException(`skill ${id} not found`);
      }
      throw error;
    }
  }

  @Post(":id/enable")
  async enableSkill(@Param("id") id: string, @Body() body: SkillTogglePayload) {
    const trimmedId = typeof id === "string" ? id.trim() : "";
    if (!trimmedId) {
      throw new BadRequestException("skill id is required");
    }
    if (typeof body?.enabled !== "boolean") {
      throw new BadRequestException("enabled flag is required");
    }
    try {
      const skill = await this.skills.setEnabled(trimmedId, body.enabled);
      const skills = await this.skills.list();
      return { skill, skills };
    } catch (error) {
      if (this.skills.isNotFound(error)) {
        throw new NotFoundException(`skill ${trimmedId} not found`);
      }
      throw error;
    }
  }

  @Post("analyze")
  @HttpCode(HttpStatus.ACCEPTED)
  async analyzeSkills(): Promise<{ ok: true; analyzed: number; candidates: SkillRecord[] }> {
    const result = await this.skills.analyze();
    return { ok: true as const, analyzed: result.analyzed, candidates: result.candidates };
  }
}
