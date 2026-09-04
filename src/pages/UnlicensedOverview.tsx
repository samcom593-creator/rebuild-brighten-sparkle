import { usePageTitle } from "@/hooks/usePageTitle";
import { SCHEDULING_LINKS } from "@/lib/apexConfig";
import { Link } from "react-router-dom";

// Public bridge for unlicensed prospects. The licensing video is the primary
// next step; a manager call remains available for applicants who need help.

const CALENDLY_URL = SCHEDULING_LINKS.unlicensed;

const steps = [
  {
    n: 1,
    title: "Watch the licensing walkthrough",
    body: "Start with the six-minute 2026 process so you know the correct order for your course, exam, fingerprints, application, and license verification.",
  },
  {
    n: 2,
    title: "Sign your carrier contracts",
    body: "Once you're licensed, we appoint you with our carrier panel so you can write business day one.",
  },
  {
    n: 3,
    title: "Make your first dial",
    body: "Warm leads + a proven script. Your manager runs your first dial with you on the line.",
  },
  {
    n: 4,
    title: "Lock in your first close",
    body: "You dial warm leads with a proven script and your manager on the line. Your first paid policy issues, and your commission check follows.",
  },
];

export default function UnlicensedOverview() {
  usePageTitle("Your first 2 months at APEX — from unlicensed to first check");

  return (
    <main
      style={{ backgroundColor: "#0a0a0a", color: "#ffffff", minHeight: "100vh" }}
      className="w-full"
    >
      <section className="px-5 pt-16 pb-12 sm:pt-24 sm:pb-16 max-w-2xl mx-auto">
        <div className="text-center">
          <p className="text-xs sm:text-sm uppercase tracking-[0.18em] text-teal-400 font-semibold mb-4">
            Apex Financial
          </p>
          <h1 className="text-3xl sm:text-5xl font-bold leading-tight">
            From unlicensed to your first commission check.
          </h1>
          <p className="mt-5 text-base sm:text-lg text-muted-foreground leading-relaxed">
            Here's exactly how new unlicensed agents go from zero to their first
            paid policy at Apex, and what we cover on a call together.
          </p>
        </div>

        <div className="mt-10 sm:mt-12 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <Link
            to="/get-licensed#licensing-video"
            className="inline-block bg-teal-500 hover:bg-teal-400 transition-colors text-black font-bold text-base sm:text-lg px-7 py-4 rounded-lg shadow-lg shadow-teal-500/20"
          >
            Watch: How to Get Your Life Insurance License
          </Link>
          <a
            href={CALENDLY_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-block rounded-lg border border-border px-7 py-4 text-base font-semibold text-white transition-colors hover:border-teal-500/50 hover:bg-teal-500/10 sm:text-lg"
          >
            Ask a manager
          </a>
        </div>

        <p className="mt-3 text-center text-xs text-muted-foreground">
          Watch first. Then use the roadmap or ask a manager if you get stuck.
        </p>
      </section>

      <section className="px-5 pb-16 sm:pb-24 max-w-2xl mx-auto">
        <h2 className="text-xl sm:text-2xl font-bold mb-6 text-foreground">
          The 4 steps to your first check
        </h2>
        <p className="text-sm text-muted-foreground mb-6 leading-relaxed">
          Licensing runs about 4 weeks. First commission typically follows
          inside 30 days after that. Your pace decides the ceiling.
        </p>
        <ol className="space-y-4">
          {steps.map((s) => (
            <li
              key={s.n}
              className="rounded-xl border border-border bg-card/60 p-5 sm:p-6"
            >
              <div className="flex items-start gap-4">
                <span
                  aria-hidden
                  className="shrink-0 inline-flex items-center justify-center w-9 h-9 rounded-full bg-teal-500 text-black font-bold text-base"
                >
                  {s.n}
                </span>
                <div>
                  <h3 className="text-base sm:text-lg font-semibold text-foreground">
                    {s.title}
                  </h3>
                  <p className="mt-1.5 text-sm sm:text-base text-muted-foreground leading-relaxed">
                    {s.body}
                  </p>
                </div>
              </div>
            </li>
          ))}
        </ol>

        <div className="mt-10 sm:mt-12 rounded-xl border border-teal-500/20 bg-teal-500/5 p-5 sm:p-6 text-center">
          <p className="text-sm sm:text-base text-foreground leading-relaxed">
            Put the licensing steps in the right order before you spend money,
            schedule an exam, or submit an application.
          </p>
          <Link
            to="/get-licensed#licensing-video"
            className="mt-5 inline-block bg-teal-500 hover:bg-teal-400 transition-colors text-black font-bold text-base px-6 py-3 rounded-lg"
          >
            Watch the licensing walkthrough
          </Link>
        </div>

        <p className="mt-10 text-center text-xs text-muted-foreground">
          Apex Financial &nbsp;|&nbsp; sam@apex-financial.org
        </p>
      </section>
    </main>
  );
}
