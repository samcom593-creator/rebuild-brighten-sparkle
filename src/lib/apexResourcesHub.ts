import { useQuery } from "@tanstack/react-query";

/**
 * apexResourcesHub — data layer for the in-app Training Hub.
 *
 * Reads the LIVE apex-resources.vercel.app content API (CORS is open:
 * access-control-allow-origin: *), so the hub renders whatever Sam's content
 * team publishes through the existing apex-resources admin portal — no more
 * hand-harvested static mirrors going stale (ResourcesLicensing.tsx froze at
 * 13 recordings on 2026-07-01 while the live library grew to 22).
 *
 * The API is the merged truth: it already contains the static seed items
 * (playbook, needs-quiz, scripts) plus everything added via the admin portal,
 * and hides drafts server-side via draftIds.
 */

export const HUB_ORIGIN = "https://apex-resources.vercel.app";

export interface HubPresenter {
  id: string;
  name: string;
  role: string;
  initials: string;
}

export interface HubRecording {
  id: string;
  presenter: string;
  title: string;
  topic: string;
  date: string;
  audio?: boolean;
  video?: string;
  desc?: string;
  duration?: string;
}

export interface HubQuizQuestion {
  q: string;
  options: string[];
  answer: number;
}

export interface HubCourseItem {
  id: string;
  kind: "lesson" | "quiz";
  title: string;
  media?: string;
  duration?: string;
  link?: string;
  blurb?: string;
  pass?: number;
  questions?: HubQuizQuestion[];
}

export interface HubCourseModule {
  title: string;
  items: HubCourseItem[];
}

export interface HubCourseInfo {
  instructor: string;
  instructorRole: string;
  level: string;
  learn: string[];
  modules: HubCourseModule[];
}

export type HubResourceType = "course" | "pdf" | "guide" | "video" | "training";

export interface HubResource {
  id: string;
  type: HubResourceType;
  title: string;
  desc: string;
  long?: string;
  date: string;
  meta?: string;
  cta?: string;
  url?: string;
  tags?: string[];
  duration?: string;
  featured?: boolean;
  isNew?: boolean;
  course?: HubCourseInfo;
}

export interface HubQuickLink {
  id?: string;
  label: string;
  sub: string;
  href: string;
}

export interface HubData {
  recordings: HubRecording[];
  presenters: HubPresenter[];
  resources: HubResource[];
  quickLinks: HubQuickLink[];
}

export interface HubTranscriptUtterance {
  startMs: number;
  speaker?: string;
  text: string;
}

export interface HubTranscript {
  status: string;
  text?: string;
  utterances?: HubTranscriptUtterance[];
}

/** Relative asset paths in the API (e.g. "assets/APEX_Agent_Playbook.pdf") are
 *  relative to the apex-resources origin — absolutize them so they open from
 *  apex-financial.org. "#" means "no external URL" (courses) → null. */
export function absolutizeHubUrl(url: string | undefined): string | null {
  if (!url || url === "#") return null;
  if (/^https?:\/\//i.test(url)) return url;
  return `${HUB_ORIGIN}/${url.replace(/^\//, "")}`;
}

/** Normalize a Google Drive / YouTube link into an embeddable iframe src, or
 *  null if the URL is not on an allow-listed host.
 *
 *  FAILS CLOSED on purpose. The video/link fields come from a separate-origin
 *  content API edited behind a shared content-team password, so they are a
 *  lower-trust input than the authenticated agents who render them. Returning
 *  an unrecognized URL verbatim would make it the src of a live iframe inside
 *  the authenticated app — a stored-content-injection path to a framed
 *  phishing page. Unknown host = refuse to embed; the caller shows a
 *  "video unavailable" state instead.
 *
 *  Drive share links arrive in /view?usp=... form from the admin portal and
 *  must be rewritten to /preview to embed. YouTube goes through the
 *  privacy-enhanced nocookie host (matches the LazyYouTube convention). */
export function toHubEmbedUrl(src: string): string | null {
  const drive = src.match(/drive\.google\.com\/(?:file\/d\/|open\?id=)([^/?#&]+)/);
  if (drive) return `https://drive.google.com/file/d/${drive[1]}/preview`;
  const yt = src.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([A-Za-z0-9_-]{11})/);
  if (yt) return `https://www.youtube-nocookie.com/embed/${yt[1]}?rel=0`;
  return null;
}

/** Sandbox for hub media iframes. Deliberately omits allow-top-navigation
 *  (and its by-user-activation variant) so a framed page can never redirect
 *  the authenticated session. Drive /preview and YouTube embeds both play
 *  normally under this set. */
export const HUB_EMBED_SANDBOX = "allow-scripts allow-same-origin allow-presentation allow-popups";

export function hubCourseItems(course: HubCourseInfo): HubCourseItem[] {
  return course.modules.flatMap((m) => m.items);
}

export function hubCourseCounts(course: HubCourseInfo): { lessons: number; quizzes: number } {
  const items = hubCourseItems(course);
  return {
    lessons: items.filter((it) => it.kind === "lesson").length,
    quizzes: items.filter((it) => it.kind === "quiz").length,
  };
}

async function fetchHubData(): Promise<HubData> {
  const res = await fetch(`${HUB_ORIGIN}/api/data`);
  if (!res.ok) throw new Error(`apex-resources API returned ${res.status}`);
  const raw = await res.json();
  const recordings: HubRecording[] = Array.isArray(raw?.recordings) ? raw.recordings : [];
  const presenters: HubPresenter[] = Array.isArray(raw?.presenters) ? raw.presenters : [];
  const resources: HubResource[] = (Array.isArray(raw?.resources) ? raw.resources : []).map(
    (r: HubResource) => ({ ...r, url: absolutizeHubUrl(r.url) ?? undefined }),
  );
  const quickLinks: HubQuickLink[] = (Array.isArray(raw?.quickLinks) ? raw.quickLinks : []).filter(
    (l: HubQuickLink) => l?.href && l.href !== "#",
  );
  return { recordings, presenters, resources, quickLinks };
}

async function fetchHubTranscripts(): Promise<Record<string, HubTranscript>> {
  const res = await fetch(`${HUB_ORIGIN}/api/transcripts`);
  if (!res.ok) throw new Error(`transcripts API returned ${res.status}`);
  const raw = await res.json();
  return raw && typeof raw === "object" ? raw : {};
}

export function useHubData() {
  return useQuery({
    queryKey: ["apex-resources-hub-data"],
    queryFn: fetchHubData,
    staleTime: 5 * 60 * 1000,
    retry: 2,
  });
}

/** ~1.5 MB payload — only fetched once a recording player actually opens
 *  (enabled flag), then cached for the session. */
export function useHubTranscripts(enabled: boolean) {
  return useQuery({
    queryKey: ["apex-resources-hub-transcripts"],
    queryFn: fetchHubTranscripts,
    staleTime: Infinity,
    enabled,
    retry: 1,
  });
}
