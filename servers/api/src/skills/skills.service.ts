import { Injectable } from "@nestjs/common";

import {
  SkillNotFoundError,
  type SkillRecord,
  type SkillsRepository,
  createInMemorySkillsRepository,
  createSqliteSkillsRepository,
} from "../../../../packages/skills/storage";
import {
  HeuristicSkillSummariser,
  runDefaultSkillAnalysis,
} from "../../../../packages/skills/pipeline";
import { DatabaseService } from "../database/database.service";

export interface SkillsAnalysisResult {
  analyzed: number;
  candidates: SkillRecord[];
}

@Injectable()
export class SkillsService {
  private readonly repository: SkillsRepository;

  constructor(private readonly database: DatabaseService) {
    this.repository = database.db
      ? createSqliteSkillsRepository(database.db)
      : createInMemorySkillsRepository();
  }

  async list(): Promise<SkillRecord[]> {
    return this.repository.list();
  }

  async listCandidates(): Promise<SkillRecord[]> {
    const skills = await this.repository.list();
    return skills.filter((skill) => skill.review_status !== "approved");
  }

  async setEnabled(id: string, enabled: boolean): Promise<SkillRecord> {
    return this.repository.setEnabled(id, enabled);
  }

  isNotFound(error: unknown): error is SkillNotFoundError {
    return error instanceof SkillNotFoundError;
  }

  async analyze(): Promise<SkillsAnalysisResult> {
    const summariser = new HeuristicSkillSummariser();
    const result = await runDefaultSkillAnalysis(summariser, {
      skillsRepository: this.repository,
      db: this.database.db ?? undefined,
    });
    return { analyzed: result.analyzedEvents, candidates: result.candidates };
  }
}
