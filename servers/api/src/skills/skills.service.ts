import { Injectable } from "@nestjs/common";
import {
  listSkills,
  setSkillEnabled,
  SkillNotFoundError,
  type SkillMetadata,
} from "../../../../lib/skills";

@Injectable()
export class SkillsService {
  async list(): Promise<SkillMetadata[]> {
    return listSkills();
  }

  async setEnabled(id: string, enabled: boolean): Promise<SkillMetadata> {
    return setSkillEnabled(id, enabled);
  }

  isNotFound(error: unknown): error is SkillNotFoundError {
    return error instanceof SkillNotFoundError;
  }
}
