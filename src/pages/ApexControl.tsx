import { useMemo } from "react";
import {
  ArrowRight,
  CheckCircle2,
  ClipboardCopy,
  Code2,
  CreditCard,
  Film,
  FolderKanban,
  Gauge,
  Inbox,
  Laptop,
  ListChecks,
  Monitor,
  ShieldAlert,
  Sparkles,
  Terminal,
} from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { cn } from "@/lib/utils";

const prompts = [
  {
    title: "Permanent Claude Project Brain",
    where: "Paste once in Claude Project instructions",
    icon: Sparkles,
    body: `You are my APEX Command Center.

Your job is to help Samuel James aggressively scale Apex Financial while keeping my life simple, protecting credits, and reducing overwhelm.

My priorities:
1. Scale Apex Financial recruiting.
2. Bring in more qualified applicants.
3. Increase agent activation and production.
4. Grow @SamuelJamesHQ as the face of the space.
5. Build low-ticket and high-ticket offers around sales, mentorship, fitness, mindset, and agency growth.
6. Keep my digital life clean: chats, inbox, bookmarks, camera roll, downloads, calendar, tasks.

How to operate:
- Claude is the command center.
- Codex handles website, code, terminal, Supabase, dashboards, commits, tests, and computer work.
- Gemini / Google Flow handles video, content, B-roll, shorts, YouTube, thumbnails, and creative visuals.
- Haiku only handles cheap small rewrites or summaries.
- Use local files, memory, status, and existing context before spending more model credits.
- Do not open parallel Claude chats for the same goal.
- Do not burn credits just because work exists.
- Do not spend money, buy credits, upgrade plans, delete important files, or send outbound messages without my approval.

If I am out of Claude credits:
- Tell me exactly what Codex can handle.
- Give me a Codex-ready terminal prompt if needed.
- Do not suggest opening more Claude chats.

When I ask for something messy:
1. Translate it into a simple task.
2. Tell me who should handle it: Claude, Codex, Gemini/Flow, or local files.
3. Tell me what happens next.
4. Tell me what I need to do, if anything.
5. Keep the answer simple.`,
  },
  {
    title: "Codex Terminal Worker",
    where: "Paste in Codex when Claude is out or the task is computer/code work",
    icon: Terminal,
    body: `You are the APEX terminal and computer worker for Samuel James.

Do not use Claude credits.
Do not make the task bigger than needed.
Do not spend money.
Do not permanently delete anything without approval.

Your role:
- Website fixes
- Dashboard fixes
- CRM / commissions / login / Supabase work
- Terminal commands
- File organization
- Local status checks
- Git commits
- Building tools that make Sam's life easier

Before working, inspect local status if available:
- /Users/samjames/business-ops/session-state/SAM-STATUS.md
- /Users/samjames/business-ops/master-prompts/100-one-chat-ai-command-center.md
- /Users/samjames/business-ops/master-prompts/101-sam-daily-ai-operating-flow.md
- /Users/samjames/business-ops/master-prompts/102-apex-one-prompt-system.md

Current task:
[TYPE TASK HERE]

Rules:
1. Keep it simple.
2. Use local files first.
3. If this is code, fix it, test it, and give receipts.
4. If this is cleanup, preview what will change before deleting.
5. If this requires Claude strategy, tell Sam to save it for Claude reset.
6. If this can be done without Claude, do it.`,
  },
  {
    title: "Claude Out Of Credits",
    where: "Paste in Codex when Claude says you are capped",
    icon: CreditCard,
    body: `Claude is out of credits.

Use Codex only.

Task:
[TYPE TASK]

Do not use Claude.
Do not spend money.
Do not permanently delete anything.
If this is code/computer/local cleanup, handle it.
If this is strategy, summarize what I should save for Claude when credits reset.`,
  },
  {
    title: "Digital Cleanup",
    where: "Paste in Codex for email, bookmarks, YouTube, camera roll, desktop, downloads",
    icon: Inbox,
    body: `Help me clean up my digital life.

Area to clean:
[YouTube history / bookmarks / Gmail inbox / camera roll / desktop / downloads / calendar / all]

Goal:
Make it easier for me to focus, scale Apex, create content, and stop feeling overwhelmed.

Rules:
- Do not permanently delete anything without showing me a preview first.
- Organize before deleting.
- Create simple categories.
- Remove obvious spam/junk only after approval.
- Promote important emails like info@, sales@, Apex, clients, recruits, Stripe, Google, Supabase, Claude, OpenAI, Gemini, and business-critical accounts.
- Make the result visually simple.

For this cleanup:
1. Tell me what you can access.
2. Show me the categories you will use.
3. Show me what would be archived, deleted, labeled, or kept.
4. Wait for approval before permanent deletion.
5. After approval, execute and give receipts.`,
  },
  {
    title: "Gemini / Google Flow Content",
    where: "Use when it is time to post, create, edit, or plan video",
    icon: Film,
    body: `Make a Gemini / Google Flow prompt pack.

Content idea:
[TYPE IDEA]

Goal:
[recruiting / sales / YouTube / TikTok / training / ad / authority]

Audience:
[WHO THIS IS FOR]

Assets:
[footage, transcript, images, screenshots, or "none"]

Output:
[short-form / long-form / B-roll / intro / thumbnail / scene]

Style:
Samuel James / APEX Standard. Direct, high-standard, masculine, faith-aware, not corporate, not fake hype.

Keep spend low.
Tell me whether this should be Gemini or Google Flow.
Give me the exact prompt to paste.`,
  },
  {
    title: "SD Card / Footage Import",
    where: "Paste in Codex when you need footage moved and organized",
    icon: FolderKanban,
    body: `Help me import and organize SD card footage.

Goal:
Move footage safely, organize it for content, and do not lose anything.

Rules:
- Do not delete from the SD card until files are copied and verified.
- Create folders by date and project.
- Separate long-form, short-form, B-roll, thumbnails, screenshots, and raw archive.
- Give me a simple folder path when done.

Task:
Import this SD card footage and organize it for Samuel James / Apex content.`,
  },
];

const lanes = [
  {
    title: "Claude",
    icon: Sparkles,
    state: "Command center",
    goodFor: "Strategy, priorities, messy thoughts, offers, content direction.",
    whenCapped: "Stop opening Claude chats. Save strategy questions for reset.",
  },
  {
    title: "Codex",
    icon: Code2,
    state: "Computer worker",
    goodFor: "Website, CRM, commissions, terminal, Supabase, cleanup previews.",
    whenCapped: "Use Codex for anything local, code, or computer-based.",
  },
  {
    title: "Gemini / Flow",
    icon: Film,
    state: "Content/video lane",
    goodFor: "Shorts, B-roll, YouTube scenes, AI video, thumbnails, visual hooks.",
    whenCapped: "Use when the job is content, not strategy or code.",
  },
  {
    title: "Status",
    icon: Gauge,
    state: "Visual truth",
    goodFor: "What shipped, what is next, what is blocked, credit mode.",
    whenCapped: "Use this page first instead of opening more chats.",
  },
];

const currentSnapshot = [
  "Claude background auto-resume is manual-only.",
  "Codex smart handoff is on for P0 website/code work only.",
  "Finance, social, and broad bots are manual-only by default.",
  "Next P0 lane: Schedule, ReadyMode sync, AgentLink sync, System Setup, Seminar form.",
];

const nextBuilds = [
  "Wire live SAM-STATUS into this page through a safe backend bridge.",
  "Add editable to-do list backed by Supabase.",
  "Add content queue and Gemini/Flow job receipts.",
  "Add one-click cleanup launchers that preview before deleting.",
];

function copyPrompt(title: string, body: string) {
  navigator.clipboard
    .writeText(body)
    .then(() => toast.success(`${title} copied`))
    .catch(() => toast.error("Copy failed"));
}

function Surface({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cn(
        "rounded-md border border-white/10 bg-white dark:bg-slate-950/70 p-4 shadow-[0_18px_50px_rgba(2,6,23,0.35)]",
        className
      )}
    >
      {children}
    </section>
  );
}

export default function ApexControl() {
  const primaryPrompts = useMemo(() => prompts.slice(0, 4), []);
  const contentPrompts = useMemo(() => prompts.slice(4), []);

  return (
    <main className="min-h-screen bg-[#020617] text-slate-900 dark:text-slate-100">
      <div className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        <PageHeader
          eyebrow="Admin control room"
          title="APEX Control"
          subtitle="One clean place for credits, tasks, status, and the prompts Sam actually needs."
        />

        <div className="mt-6 grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
          <Surface>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <Gauge className="h-5 w-5 text-emerald-300" />
                  <h2 className="text-lg font-bold">What is happening right now</h2>
                </div>
                <p className="mt-1 text-sm text-slate-400">
                  Static v1. It shows the current operating mode. Live file sync comes next.
                </p>
              </div>
              <Badge className="w-fit border-emerald-400/30 bg-emerald-400/10 text-emerald-200">
                Credit-safe mode
              </Badge>
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              {currentSnapshot.map((line) => (
                <div key={line} className="flex gap-3 rounded-md border border-white/10 bg-white/[0.03] p-3">
                  <CheckCircle2 className="mt-0.5 h-4 w-4 flex-shrink-0 text-emerald-300" />
                  <p className="text-sm text-slate-700 dark:text-slate-200">{line}</p>
                </div>
              ))}
            </div>
          </Surface>

          <Surface>
            <div className="flex items-center gap-2">
              <ShieldAlert className="h-5 w-5 text-amber-300" />
              <h2 className="text-lg font-bold">When Claude is out of credits</h2>
            </div>
            <ol className="mt-4 space-y-3 text-sm text-slate-700 dark:text-slate-200">
              <li className="flex gap-3">
                <span className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-md bg-emerald-400/15 text-xs font-bold text-emerald-200">1</span>
                Stop opening more Claude chats.
              </li>
              <li className="flex gap-3">
                <span className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-md bg-emerald-400/15 text-xs font-bold text-emerald-200">2</span>
                Use Codex for website, terminal, cleanup, and computer tasks.
              </li>
              <li className="flex gap-3">
                <span className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-md bg-emerald-400/15 text-xs font-bold text-emerald-200">3</span>
                Use Gemini or Flow only for content/video tasks.
              </li>
              <li className="flex gap-3">
                <span className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-md bg-emerald-400/15 text-xs font-bold text-emerald-200">4</span>
                Save big strategy questions for Claude reset.
              </li>
            </ol>
          </Surface>
        </div>

        <div className="mt-4 grid gap-4 lg:grid-cols-4">
          {lanes.map((lane) => (
            <Surface key={lane.title}>
              <lane.icon className="h-5 w-5 text-emerald-300" />
              <h3 className="mt-3 text-base font-bold">{lane.title}</h3>
              <p className="mt-1 text-xs font-semibold uppercase tracking-[0.18em] text-emerald-200">{lane.state}</p>
              <p className="mt-3 text-sm text-slate-600 dark:text-slate-300">{lane.goodFor}</p>
              <p className="mt-3 text-xs text-slate-600 dark:text-slate-300">{lane.whenCapped}</p>
            </Surface>
          ))}
        </div>

        <div className="mt-4 grid gap-4 lg:grid-cols-[0.9fr_1.1fr]">
          <Surface>
            <div className="flex items-center gap-2">
              <ListChecks className="h-5 w-5 text-emerald-300" />
              <h2 className="text-lg font-bold">What to build next</h2>
            </div>
            <div className="mt-4 space-y-3">
              {nextBuilds.map((item) => (
                <div key={item} className="flex gap-3 rounded-md border border-white/10 bg-white/[0.03] p-3">
                  <ArrowRight className="mt-0.5 h-4 w-4 flex-shrink-0 text-emerald-300" />
                  <p className="text-sm text-slate-700 dark:text-slate-200">{item}</p>
                </div>
              ))}
            </div>
          </Surface>

          <Surface>
            <div className="flex items-center gap-2">
              <Laptop className="h-5 w-5 text-emerald-300" />
              <h2 className="text-lg font-bold">Device map</h2>
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              {[
                ["MacBook now", "Temporary command machine and Codex terminal."],
                ["New Mac desktop", "Primary runner once it arrives. Keep it awake."],
                ["iPad / phone", "Review, approve, capture content, handle 2FA."],
                ["Windows", "Testing, uploads, downloads, separate jobs only."],
              ].map(([name, use]) => (
                <div key={name} className="rounded-md border border-white/10 bg-white/[0.03] p-3">
                  <div className="flex items-center gap-2">
                    <Monitor className="h-4 w-4 text-emerald-300" />
                    <p className="text-sm font-bold text-white">{name}</p>
                  </div>
                  <p className="mt-2 text-sm text-slate-400">{use}</p>
                </div>
              ))}
            </div>
          </Surface>
        </div>

        <section className="mt-6">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-xl font-bold">Copy prompts</h2>
              <p className="mt-1 text-sm text-slate-400">Each card says exactly where it goes.</p>
            </div>
            <Badge className="border-white/10 bg-white/[0.05] text-slate-600 dark:text-slate-300">
              No Notes folder needed
            </Badge>
          </div>

          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            {[...primaryPrompts, ...contentPrompts].map((prompt) => (
              <Surface key={prompt.title}>
                <div className="flex items-start justify-between gap-3">
                  <div className="flex gap-3">
                    <prompt.icon className="mt-1 h-5 w-5 flex-shrink-0 text-emerald-300" />
                    <div>
                      <h3 className="text-base font-bold">{prompt.title}</h3>
                      <p className="mt-1 text-sm text-slate-400">{prompt.where}</p>
                    </div>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => copyPrompt(prompt.title, prompt.body)}
                    className="h-9 flex-shrink-0 border-emerald-400/30 bg-emerald-400/10 text-emerald-100 hover:bg-emerald-400/20"
                  >
                    <ClipboardCopy className="mr-2 h-4 w-4" />
                    Copy
                  </Button>
                </div>
                <pre className="mt-4 max-h-52 overflow-auto rounded-md border border-white/10 bg-white dark:bg-black/30 p-3 text-xs leading-relaxed text-slate-600 dark:text-slate-300">
                  {prompt.body}
                </pre>
              </Surface>
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}
