import { ArtifactChecker } from './ArtifactChecker.js';
import type { Artifact } from '../contracts/artifact.js';

export interface VerificationResult {
  success: boolean;
  artifactResults: Array<{ artifactId: string; pass: boolean; failures: string[] }>;
  repairs?: Array<{ artifactId: string; action: string }>;
}

export class ExecutionVerifier {
  static async verify(artifacts: Artifact[]): Promise<VerificationResult> {
    const artifactResults = await Promise.all(artifacts.map(async (art) => {
      const checkResult = await ArtifactChecker.check(art.type, art.metadata);
      return {
        artifactId: art.id,
        pass: checkResult.pass,
        failures: checkResult.checks.filter(c => !c.pass).map(c => c.name),
      };
    }));
    return { success: artifactResults.every(r => r.pass), artifactResults };
  }
}
