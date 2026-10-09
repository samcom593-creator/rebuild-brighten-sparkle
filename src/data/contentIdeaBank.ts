import type { PickIdea } from "@/lib/contentPicks";

/**
 * The saved idea bank behind the Launch Board's "Film next". Written once, by hand, so choosing what to film costs
 * nothing at runtime. Every idea carries a real premise, the payoff for the viewer, an opening line, the beats to hit
 * and (for vlogs) the shots to capture.
 *
 * Rules these ideas follow:
 *   - No fact about Sam's life is stated for him. Beats ask for the real example, the real number or the real moment,
 *     and he fills it in on camera. An idea he cannot answer truthfully gets dismissed, not filmed.
 *   - Nothing here sells. No offer, product or price appears, and no idea is forced into an insurance pitch. The
 *     educational ideas explain; they do not ask for a sale.
 *   - Vlogs list what to capture. The cut is his own.
 *   - `minutes` is time to film, not time to edit.
 */
const ALL: Array<Omit<PickIdea, "source">> = [
  // ── Gym ────────────────────────────────────────────────────────────────────────────────────────────────────
  {
    key: "bank:gym-leg-day-straight", title: "A full leg day, filmed straight", lane: "gym", format: "long", kind: "vlog",
    platforms: ["YouTube"], minutes: 120, locations: ["gym"],
    premise: "One complete leg session with the phone on the rack, plus what goes through your head on the hardest set.",
    payoff: "A way to keep going on the set where you normally quit.",
    hook: "The fourth set is where most people stop. Watch what I do instead.",
    why: "Gym content that shows effort and the mental side, not a highlight reel.",
    beats: [
      "Say the goal for the session in one sentence before the first rep.",
      "Film the warm-up and the heaviest working set without cutting away.",
      "On the hardest set, say the exact thought that makes you want to stop.",
      "Say what you do about that thought, in one sentence.",
      "After the last set, name the one thing you would repeat tomorrow.",
    ],
    shots: [
      "Wide shot of the gym floor on arrival",
      "Phone on the rack, full body, first working set",
      "Close on your face between sets, not posed",
      "The bar loaded, with the plate numbers readable",
      "The final set, then the walk away from the rack",
      "One line to camera in the car or the parking lot",
    ],
    ending: "Name the single habit you will repeat tomorrow and say when you will do it.", score: 88,
  },
  {
    key: "bank:gym-first-appointment", title: "My first appointment every day is the gym", lane: "gym", format: "long", kind: "vlog",
    platforms: ["YouTube"], minutes: 180, locations: ["gym", "office", "home"],
    premise: "Follow one weekday from the first alarm to the last call, with the gym as the first appointment of the day.",
    payoff: "A real schedule a viewer can borrow, with the parts that go wrong left in.",
    hook: "My first appointment every day is not a client. It is the gym.",
    why: "Ties training to running a business, which is the story only you can tell.",
    beats: [
      "Say the wake time and why it is that time.",
      "Gym block: what you train, how long, and what you skip.",
      "The first work task and why it comes before email.",
      "Midday: the hardest thing on the calendar and how you handle it.",
      "Evening: what you finish, what you leave undone, and why that is fine.",
    ],
    shots: [
      "The alarm and the first thirty seconds of the day",
      "The gym entrance and the first set",
      "The desk and the first task on screen, with nothing private visible",
      "One real call or meeting moment, with no client names or client screens",
      "A meal, in whatever form it really is",
      "The closing line to camera at night",
    ],
    ending: "Give one thing from the day a viewer could copy tomorrow.", score: 84,
  },
  {
    key: "bank:gym-skip-rule", title: "The rule that keeps me from skipping the gym", lane: "gym", format: "short", kind: "talking_head",
    platforms: ["YouTube", "Instagram", "TikTok"], minutes: 20, locations: ["car", "home", "gym", "anywhere"],
    premise: "One rule, said plainly: you do not negotiate with yourself after the alarm goes off.",
    payoff: "A rule the viewer can use tomorrow morning.",
    hook: "I made one rule so I never have to decide whether to go.",
    why: "Short, direct and easy to repeat. It fits the discipline lane.",
    beats: [
      "State the rule in one sentence.",
      "Say what the old way was and what it cost you.",
      "Say what you do in the first minute after the alarm.",
    ],
    shots: [], ending: "Ask viewers to set the same rule tonight and tell you what time they will go.", score: 79,
  },
  {
    key: "bank:gym-first-week", title: "First week in a gym: do only these three things", lane: "gym", format: "short", kind: "talking_head",
    platforms: ["YouTube", "Instagram", "TikTok"], minutes: 25, locations: ["gym", "anywhere"],
    premise: "A beginner's first week, cut down to the three things that matter.",
    payoff: "A plan a nervous beginner can actually follow.",
    hook: "If this is your first week in a gym, do these three things and ignore the rest.",
    why: "Useful to a wide audience and it shows you know the basics, not just the hard stuff.",
    beats: [
      "Show up at the same time three days. That is the whole goal.",
      "Pick three basic movements and learn them slowly.",
      "Write the numbers down so next week has a target.",
    ],
    shots: [], ending: "Tell them to start tomorrow, not next Monday.", score: 72,
  },
  {
    key: "bank:gym-training-day-plate", title: "Everything I ate on a training day", lane: "gym", format: "short", kind: "vlog",
    platforms: ["YouTube", "Instagram", "TikTok"], minutes: 60, locations: ["home"],
    premise: "Every meal from one training day, shown as it really is.",
    payoff: "A simple pattern, not a diet.",
    hook: "This is everything I ate on a training day, with no editing of the plate.",
    why: "Easy to film in passing and people save it.",
    beats: [
      "Say what the day was for.",
      "Name the pattern you follow, in a sentence.",
      "Say what you do not count, and why.",
    ],
    shots: ["Breakfast on the counter", "The midday meal and where it was eaten", "A snack that is not perfect", "The evening meal and what you drink with it"],
    ending: "Name one change a viewer could make this week.", score: 66,
  },

  // ── Mindset and lifestyle ─────────────────────────────────────────────────────────────────────────────────
  {
    key: "bank:mindset-not-ready", title: "You will not feel ready. Start anyway.", lane: "mindset", format: "short", kind: "talking_head",
    platforms: ["YouTube", "Instagram", "TikTok"], minutes: 20, locations: ["car", "anywhere"],
    premise: "Readiness is a feeling that shows up after you start, so starting is the plan.",
    payoff: "Permission to begin the thing you keep putting off.",
    hook: "You will not feel ready. I have checked.",
    why: "A direct message to the people who follow you for the push.",
    beats: [
      "Name one thing you started before you felt ready.",
      "Say what happened in the first week.",
      "Give the smallest first step a viewer can do today.",
    ],
    shots: [], ending: "Ask them to do the smallest step before they scroll again.", score: 83,
  },
  {
    key: "bank:life-ordinary-tuesday", title: "A real Tuesday running my agency", lane: "mindset", format: "long", kind: "vlog",
    platforms: ["YouTube"], minutes: 180, locations: ["office", "home", "car"],
    premise: "One ordinary workday, showing the calls, the problems and the small wins.",
    payoff: "An honest look at what building a business looks like day to day.",
    hook: "Nobody films the boring parts of running a business, so I did.",
    why: "Shows the work behind the results, which builds trust faster than a highlight reel.",
    beats: [
      "Say what you planned for the day and what actually happened.",
      "Show the first problem and what you did about it.",
      "Show one conversation with a team member, with no names on screen.",
      "Show the thing you did not want to do and did anyway.",
      "End with the one number or win you are proud of today.",
    ],
    shots: [
      "The morning setup before anyone else is up",
      "Walking in or sitting down to the first task",
      "A call or message exchange with private details hidden",
      "A frustrating moment, filmed honestly",
      "A quiet moment between tasks",
      "The close of the day and one line to camera",
    ],
    ending: "Say what tomorrow's first task is, out loud, so you are held to it.", score: 86,
  },
  {
    key: "bank:life-sunday-reset", title: "My Sunday reset: how I plan the week", lane: "mindset", format: "long", kind: "vlog",
    platforms: ["YouTube"], minutes: 90, locations: ["home"],
    premise: "A forty-minute Sunday routine that decides the week before it starts.",
    payoff: "A planning routine a viewer can copy tonight.",
    hook: "Monday is won on Sunday night, and it takes forty minutes.",
    why: "Practical, repeatable and easy to film at home.",
    beats: [
      "Clear the week's loose ends into one list.",
      "Pick the three outcomes that matter most.",
      "Put the gym, the calls and the filming on the calendar first.",
      "Decide what you will say no to this week.",
    ],
    shots: ["The desk and a notebook", "The calendar on screen with client details hidden", "The three outcomes written out", "Lights off and phone down at the end"],
    ending: "Tell viewers to pick their three outcomes before they sleep.", score: 75,
  },
  {
    key: "bank:mindset-decide-the-night-before", title: "Discipline is decided the night before", lane: "mindset", format: "short", kind: "talking_head",
    platforms: ["YouTube", "Instagram", "TikTok"], minutes: 20, locations: ["anywhere", "home"],
    premise: "You do not feel discipline in the moment. You set it up the night before.",
    payoff: "A habit that makes the morning easier.",
    hook: "Discipline is not something you feel in the moment. It is something you decide the night before.",
    why: "Short, sharp and consistent with the standard you hold.",
    beats: [
      "Say what you set out the night before.",
      "Say what the morning looks like when you skip it.",
      "Give one thing the viewer can set out tonight.",
    ],
    shots: [], ending: "Tell them to set it out now, before they close the app.", score: 77,
  },
  {
    key: "bank:mindset-before-a-hard-call", title: "What I say to myself before a hard call", lane: "mindset", format: "short", kind: "talking_head",
    platforms: ["YouTube", "Instagram", "TikTok"], minutes: 20, locations: ["car"],
    premise: "A ten-second routine before a call you are dreading.",
    payoff: "A way to walk into a hard conversation steady.",
    hook: "Before every hard call I take ten seconds and say the same three things.",
    why: "Relatable to anyone who sells or leads, and easy to film in the car.",
    beats: [
      "Say the three things out loud.",
      "Say why each one matters.",
      "Give an example of a call where it helped, with nobody named.",
    ],
    shots: [], ending: "Ask viewers what they say to themselves before something hard.", score: 74,
  },

  // ── Faith ──────────────────────────────────────────────────────────────────────────────────────────────────
  {
    key: "bank:faith-hard-business", title: "Faith when the business gets hard", lane: "faith", format: "long", kind: "talking_head",
    platforms: ["YouTube"], minutes: 60, locations: ["home"],
    premise: "How faith shows up in a hard week of running a business, without the performance.",
    payoff: "A steady way to think when results are slow.",
    hook: "I pray before I check the numbers, and here is why.",
    why: "Faith is part of who you are, and this shows it in practice instead of preaching.",
    beats: [
      "Say what a hard week looks like for you, in plain words.",
      "Say what you do first when it gets heavy.",
      "Tell one specific moment where that changed your next decision.",
      "Say what you would tell someone who does not share your faith but wants steadiness.",
    ],
    shots: [], ending: "Invite viewers to share what they lean on when it is hard.", score: 80,
  },
  {
    key: "bank:faith-read-before-phone", title: "Why I read before I touch my phone", lane: "faith", format: "short", kind: "talking_head",
    platforms: ["YouTube", "Instagram", "TikTok"], minutes: 20, locations: ["home"],
    premise: "The first ten minutes of the day decide who runs it, you or your phone.",
    payoff: "A morning habit that is easy to start.",
    hook: "The first ten minutes of the day decide who runs it, me or my phone.",
    why: "A quiet faith message that fits the morning-routine audience.",
    beats: [
      "Say what you read and for how long.",
      "Say what the morning felt like before you did this.",
      "Give one small way to start, even for two minutes.",
    ],
    shots: [], ending: "Ask them to leave the phone across the room tonight.", score: 70,
  },
  {
    key: "bank:faith-gratitude-audit", title: "Write down what you wished for a year ago", lane: "faith", format: "short", kind: "talking_head",
    platforms: ["YouTube", "Instagram", "TikTok"], minutes: 15, locations: ["anywhere"],
    premise: "Check how much of last year's wish list you already have.",
    payoff: "A reminder to be grateful and a reason to keep going.",
    hook: "Write down what you wished for a year ago, then check how much of it you already have.",
    why: "Gratitude without a lecture, and it invites comments.",
    beats: [
      "Say what you wished for a year ago, in your own words.",
      "Say what you have now that you did not then.",
      "Ask the viewer to do the same list.",
    ],
    shots: [], ending: "Ask them to write the list before bed and come back with one line.", score: 68,
  },

  // ── Building a business ───────────────────────────────────────────────────────────────────────────────────
  {
    key: "bank:biz-start-over-this-week", title: "If I had to start over this week", lane: "business", format: "long", kind: "talking_head",
    platforms: ["YouTube"], minutes: 75, locations: ["home", "office"],
    premise: "The first seven days you would run if you lost everything and kept only your skills.",
    payoff: "A concrete first-week plan for anyone starting from nothing.",
    hook: "If everything disappeared tonight, here is what I would do on Monday.",
    why: "Strong long-form with a clear structure, and it shows the thinking behind the results.",
    beats: [
      "Day one: the one list you would make.",
      "Who you would call first and what you would ask them.",
      "The first thing you would sell, and to whom.",
      "What you would refuse to spend money on.",
    ],
    shots: [], ending: "Tell viewers to write their own day-one list while the video is still playing.", score: 87,
  },
  {
    key: "bank:biz-before-your-first-hire", title: "Before you add anyone to your team, answer these three questions", lane: "business", format: "long", kind: "talking_head",
    platforms: ["YouTube"], minutes: 60, locations: ["office", "home"],
    premise: "Three questions that prevent most hiring regrets.",
    payoff: "A checklist to run before the next hire.",
    hook: "Before you add one person to your team, answer these three questions.",
    why: "You build and lead a team, and this is the part new owners get wrong.",
    beats: [
      "Question one: can you explain the job in two sentences?",
      "Question two: what does done look like for the person doing it?",
      "Question three: who is responsible when it slips?",
      "Share one real example from your own team, with no names.",
    ],
    shots: [], ending: "Ask viewers which question they could not answer yet.", score: 78,
  },
  {
    key: "bank:biz-decide-and-move", title: "How I decide when I am unsure", lane: "business", format: "short", kind: "talking_head",
    platforms: ["YouTube", "Instagram", "TikTok"], minutes: 20, locations: ["anywhere", "car"],
    premise: "One question to ask when you cannot decide, then you move.",
    payoff: "A way to stop stalling on decisions.",
    hook: "When I cannot decide, I ask one question and then I move.",
    why: "Short and useful for builders, and it shows how you think.",
    beats: [
      "Say the one question.",
      "Say what it filters out.",
      "Give a recent decision it settled, with the details that are safe to share.",
    ],
    shots: [], ending: "Ask them to use it on one stalled decision today.", score: 69,
  },
  {
    key: "bank:biz-three-numbers", title: "The three numbers I check every day", lane: "business", format: "short", kind: "talking_head",
    platforms: ["YouTube", "Instagram", "TikTok"], minutes: 20, locations: ["office", "anywhere"],
    premise: "Focus on three numbers and let everything else wait.",
    payoff: "A simple scoreboard a small business can copy.",
    hook: "I only look at three numbers every day. Everything else can wait.",
    why: "Concrete and shareable, and it teaches focus.",
    beats: [
      "Name the three numbers, with no client data on screen.",
      "Say what you do when one of them drops.",
      "Say what you ignore on purpose.",
    ],
    shots: [], ending: "Ask viewers which three they would pick.", score: 73,
  },

  // ── Educational ───────────────────────────────────────────────────────────────────────────────────────────
  {
    key: "bank:edu-life-insurance-60s", title: "Life insurance in 60 seconds", lane: "education", format: "short", kind: "talking_head",
    platforms: ["YouTube", "Instagram", "TikTok"], minutes: 25, locations: ["anywhere", "home"],
    premise: "What life insurance is, who it is for and what skipping it can cost, in plain words.",
    payoff: "A clear definition the viewer can repeat to a friend.",
    hook: "In sixty seconds, here is what life insurance does and who it is actually for.",
    why: "Plain education builds trust without a pitch.",
    beats: [
      "It pays your family a set amount if you die while the policy is in force.",
      "It is for people who have someone depending on their income.",
      "The cost depends on age and health, so earlier usually costs less.",
      "Say what it does not do.",
    ],
    shots: [], ending: "Tell them to ask any licensed agent for the cost at their age, with no commitment.", score: 76,
  },
  {
    key: "bank:edu-term-vs-whole", title: "Term or whole life: explain it to a friend", lane: "education", format: "short", kind: "talking_head",
    platforms: ["YouTube", "Instagram", "TikTok"], minutes: 25, locations: ["anywhere"],
    premise: "The difference between term and whole life, said the way you would say it over coffee.",
    payoff: "Enough clarity to know which question to ask next.",
    hook: "Term or whole life? Here is how I would explain it to a friend.",
    why: "One of the most searched questions in the space.",
    beats: [
      "Term covers a set number of years and costs less.",
      "Whole life lasts for life, builds cash value and costs more.",
      "Say who each one usually fits, and that situations differ.",
    ],
    shots: [], ending: "Tell them the right choice depends on their situation, so ask questions before deciding.", score: 71,
  },
  {
    key: "bank:edu-three-questions", title: "Three questions to ask before you buy any policy", lane: "education", format: "short", kind: "talking_head",
    platforms: ["YouTube", "Instagram", "TikTok"], minutes: 25, locations: ["anywhere"],
    premise: "Three questions that protect a buyer from a bad decision.",
    payoff: "A checklist to use in any insurance conversation.",
    hook: "Ask these three questions before you buy any insurance policy.",
    why: "Honest and protective, which is the voice that earns trust.",
    beats: [
      "Who needs this money if I am gone, and for how long?",
      "What can I pay every month without strain?",
      "Who is the company, and can the agent explain what is not covered?",
    ],
    shots: [], ending: "Tell them to screenshot the three questions.", score: 70,
  },
  {
    key: "bank:edu-licensing-steps", title: "How getting a life insurance license works, step by step", lane: "education", format: "long", kind: "talking_head",
    platforms: ["YouTube"], minutes: 60, locations: ["home", "office"],
    premise: "The path from nothing to licensed, in the order it happens.",
    payoff: "A clear picture of the process for anyone curious about the career.",
    hook: "Here is exactly how you get licensed to sell life insurance, step by step.",
    why: "Educational, searchable and useful to the people who find you.",
    beats: [
      "The pre-licensing course: what it covers and roughly how long it takes.",
      "The state exam: the format and how you schedule it.",
      "Fingerprints and the background check.",
      "Getting appointed with carriers, and what comes after.",
    ],
    shots: [], ending: "Tell viewers that requirements vary by state and to check theirs first.", score: 74,
  },
  {
    key: "bank:edu-too-young", title: "\"I'm too young for life insurance\"", lane: "education", format: "short", kind: "talking_head",
    platforms: ["YouTube", "Instagram", "TikTok"], minutes: 20, locations: ["anywhere"],
    premise: "Why waiting costs more than most people expect.",
    payoff: "A reason to look at it now, with no pressure to buy.",
    hook: "\"I'm too young for life insurance\" is one of the most expensive things people say.",
    why: "A common objection answered honestly, aimed at your own age group.",
    beats: [
      "Say why people your age put it off.",
      "Say that cost tends to rise with age and health changes.",
      "Say that looking costs nothing and buying is a choice.",
    ],
    shots: [], ending: "Tell them to find out the number, then decide for themselves.", score: 71,
  },
];

export const BANK_IDEAS: PickIdea[] = ALL.map((i) => ({ ...i, source: "bank" as const }));
