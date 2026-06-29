import { usePageTitle } from "@/hooks/usePageTitle";

// MP-224 §3: Polished /unlicensed-overview page for unlicensed applicants.
// Mobile-first (375px friendly), no Unicode middots, single Calendly CTA.

const CALENDLY_URL = "https://calendly.com/kjvaughns1/overview";

const steps = [
  {
    n: 1,
    title: "Get licensed",
    body: "We walk you through the pre-licensing course and the state exam. Most agents finish in about 4 weeks.",
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
    body: "Average new agent writes $20,000 of annual premium in month one. That's your first commission check.",
  },
];

export default function UnlicensedOverview() {
  usePageTitle("You're 4 weeks away from your first commission check · APEX Financial");

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
            You're 4 weeks away from your first commission check.
          </h1>
          <p className="mt-5 text-base sm:text-lg text-slate-300 leading-relaxed">
            Here's exactly how new unlicensed agents go from zero to their first
            paid policy at Apex, and what we cover on a call together.
          </p>
        </div>

        <div className="mt-10 sm:mt-12 flex justify-center">
          <a
            href={CALENDLY_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-block bg-teal-500 hover:bg-teal-400 transition-colors text-black font-bold text-base sm:text-lg px-7 py-4 rounded-lg shadow-lg shadow-teal-500/20"
          >
            Book Sam's Calendar
          </a>
        </div>

        <p className="mt-3 text-center text-xs text-slate-500">
          15 minutes. No pressure. Just a straight conversation.
        </p>
      </section>

      <section className="px-5 pb-16 sm:pb-24 max-w-2xl mx-auto">
        <h2 className="text-xl sm:text-2xl font-bold mb-6 text-white">
          The 4 steps to your first check
        </h2>
        <ol className="space-y-4">
          {steps.map((s) => (
            <li
              key={s.n}
              className="rounded-xl border border-slate-800 bg-slate-900/60 p-5 sm:p-6"
            >
              <div className="flex items-start gap-4">
                <span
                  aria-hidden
                  className="shrink-0 inline-flex items-center justify-center w-9 h-9 rounded-full bg-teal-500 text-black font-bold text-base"
                >
                  {s.n}
                </span>
                <div>
                  <h3 className="text-base sm:text-lg font-semibold text-white">
                    {s.title}
                  </h3>
                  <p className="mt-1.5 text-sm sm:text-base text-slate-300 leading-relaxed">
                    {s.body}
                  </p>
                </div>
              </div>
            </li>
          ))}
        </ol>

        <div className="mt-10 sm:mt-12 rounded-xl border border-teal-500/20 bg-teal-500/5 p-5 sm:p-6 text-center">
          <p className="text-sm sm:text-base text-slate-200 leading-relaxed">
            Pick a time on Sam's calendar and we'll map out exactly how your
            first 4 weeks look at Apex.
          </p>
          <a
            href={CALENDLY_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-5 inline-block bg-teal-500 hover:bg-teal-400 transition-colors text-black font-bold text-base px-6 py-3 rounded-lg"
          >
            Book Sam's Calendar
          </a>
        </div>

        <p className="mt-10 text-center text-xs text-slate-500">
          Apex Financial &nbsp;|&nbsp; sam@apex-financial.org
        </p>
      </section>
    </main>
  );
}
