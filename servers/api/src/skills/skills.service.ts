import { Injectable } from "@nestjs/common";

import {
  listSkills,
  setSkillEnabled,
  SkillNotFoundError,
  type SkillRecord,
} from "../../../../packages/skills/storage";
import {
  HeuristicSkillSummariser,
  runDefaultSkillAnalysis,
} from "../../../../packages/skills/pipeline";

export interface SkillsAnalysisResult {
  analyzed: number;
  candidates: SkillRecord[];
}

@Injectable()
export class SkillsService {
  async list(): Promise<SkillRecord[]> {
    return listSkills();
  }

  async listCandidates(): Promise<SkillRecord[]> {
    const skills = await listSkills();
    return skills.filter((skill) => skill.review_status !== "approved");
  }

  async setEnabled(id: string, enabled: boolean): Promise<SkillRecord> {
    return setSkillEnabled(id, enabled);
  }

  isNotFound(error: unknown): error is SkillNotFoundError {
    return error instanceof SkillNotFoundError;
  }

  async analyze(): Promise<SkillsAnalysisResult> {
    const summariser = new HeuristicSkillSummariser();
    const result = await runDefaultSkillAnalysis(summariser);
    return { analyzed: result.analyzedEvents, candidates: result.candidates };
  }
}
