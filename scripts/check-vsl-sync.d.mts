/** Typed contract for the shared build and commit VSL validator. */
export interface VslSyncSources {
  hero: string;
  vsl: string;
  media: string;
  index: string;
}

export interface VslSyncResult {
  release: string | null;
  problems: string[];
}

export function vslSyncProblems(sources: VslSyncSources): VslSyncResult;
export function inspectVslSync(root?: string): VslSyncResult;
