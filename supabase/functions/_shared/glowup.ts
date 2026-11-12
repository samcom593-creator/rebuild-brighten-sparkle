// The 30-Day Glow-Up (MP-BRAND-ENGINE part 6). One source for the checklist the email carries; the
// /glowup page on sell4daddy.com prints the same five daily items and four weeks.
export const GLOWUP_DAILY: { key: string; label: string; action: string }[] = [
  { key: "training", label: "Training", action: "Train 45 minutes. Lift or run. No days off from moving." },
  { key: "grooming", label: "Grooming", action: "Shower, skin, hair, teeth. Look sharp before you leave the house." },
  { key: "style", label: "Style", action: "Wear a fit you picked on purpose. Clean, pressed, it fits." },
  { key: "money", label: "Money", action: "Do one thing that moves income: a call, an application, an hour of study." },
  { key: "discipline", label: "Discipline", action: "Up at the same time. Pray or sit quiet for 5 minutes. Phone down by 11." },
];
export const GLOWUP_WEEKS: { week: number; name: string; focus: string }[] = [
  { week: 1, name: "Set the floor", focus: "Hit all five every day. Do not add anything. Take a photo on day 1." },
  { week: 2, name: "Add weight", focus: "Add a second training block on two days. Clear out clothes that do not fit." },
  { week: 3, name: "Get seen", focus: "Post one thing a day. Tell three people what you are building." },
  { week: 4, name: "Lock it in", focus: "Take the day 30 photo. Pick the next step on the ladder and commit to it." },
];
export const STAGE_NAME: Record<number, string> = { 1: "Body", 2: "First $10K", 3: "Break $10K", 4: "Become the man" };
export const STAGE_DOOR: Record<number, { label: string; url: string }> = {
  1: { label: "The Standard Body", url: "https://sell4daddy.com/body" },
  2: { label: "Join the Team", url: "https://sell4daddy.com/team" },
  3: { label: "Build Your Agency", url: "https://sell4daddy.com/build" },
  4: { label: "Private Mentorship", url: "https://sell4daddy.com/mentorship" },
};

export function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function checklistEmail(firstName: string, stage: number): { subject: string; html: string; text: string } {
  const door = STAGE_DOOR[stage] ?? STAGE_DOOR[1];
  const daily = GLOWUP_DAILY.map((d) => `${d.label}: ${d.action}`);
  const weeks = GLOWUP_WEEKS.map((w) => `Week ${w.week}, ${w.name}: ${w.focus}`);
  const text = [
    `${firstName},`, "",
    "Here is the 30-Day Glow-Up. Five things, every day, for 30 days.", "",
    ...daily.map((l, i) => `${i + 1}. ${l}`), "",
    ...weeks, "",
    "Tap each day done here: https://sell4daddy.com/glowup?utm_source=email&utm_medium=checklist", "",
    `You said you are working on ${STAGE_NAME[stage] ?? "the body"}. When you are ready for the next step: ${door.url}?utm_source=email&utm_medium=checklist`, "",
    "Results depend on your work. No income is guaranteed.", "",
    "Hold the Standard.", "Samuel James",
  ].join("\n");
  const li = (s: string) => `<li style="margin:0 0 8px">${esc(s)}</li>`;
  const html = `<div style="font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.55;color:#111;max-width:560px">
<p>${esc(firstName)},</p>
<p>Here is the 30-Day Glow-Up. Five things, every day, for 30 days.</p>
<ol style="padding-left:20px">${daily.map(li).join("")}</ol>
<ul style="padding-left:20px">${weeks.map(li).join("")}</ul>
<p><a href="https://sell4daddy.com/glowup?utm_source=email&amp;utm_medium=checklist">Tap each day done here</a>.</p>
<p>You said you are working on ${esc(STAGE_NAME[stage] ?? "the body")}. When you are ready for the next step: <a href="${door.url}?utm_source=email&amp;utm_medium=checklist">${esc(door.label)}</a>.</p>
<p style="color:#555;font-size:13px">Results depend on your work. No income is guaranteed.</p>
<p>Hold the Standard.<br>Samuel James</p>
</div>`;
  return { subject: "Your 30-Day Glow-Up", html, text };
}

/** A plain-text sequence email as simple HTML: paragraphs, and bare links made clickable. */
export function textToHtml(body: string): string {
  const paras = body.split(/\n{2,}/).map((p) => {
    const lines = esc(p).split("\n").map((l) => l.replace(/(https:\/\/[^\s<]+)/g, '<a href="$1">$1</a>'));
    return `<p style="margin:0 0 14px">${lines.join("<br>")}</p>`;
  });
  return `<div style="font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.55;color:#111;max-width:560px">${paras.join("")}</div>`;
}
