import { handleTrainingRecordingUrl, type TrainingRecordingUrlDependencies } from "./training-recording-url.ts";

export type LeadRecordingUrlDependencies = TrainingRecordingUrlDependencies;

/** Reuse the strict ID-only signer after adapting the caller-authorized lead catalog. */
export function handleLeadRecordingUrl(req: Request, deps: LeadRecordingUrlDependencies): Promise<Response> {
  return handleTrainingRecordingUrl(req, {
    ...deps,
    listRecordings: async () => {
      const result = await deps.listRecordings();
      if (result.error || !Array.isArray(result.data)) return result;
      return {
        error: null,
        data: result.data.map((row: unknown) => {
          if (!row || typeof row !== "object" || Array.isArray(row)) return null;
          const value = row as Record<string, unknown>;
          if (typeof value.path !== "string" || !value.path.startsWith("callcenter/")) return null;
          return { id: value.id, audio_path: value.path };
        }),
      };
    },
  });
}
