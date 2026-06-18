export type InboundStage = "new" | "diagnosing" | "quoted" | "follow_up" | "won" | "lost";
export type Urgency = "hot" | "warm" | "normal";

export interface InboundLead {
  id: string;
  client_first_name: string;
  client_last_name: string;
  phone: string;
  email: string;
  state: string;
  city: string;
  problem_type: string;
  urgency: Urgency;
  current_coverage: string;
  desired_solution: string;
  budget: string;
  household: string;
  notes: string;
  transcript: string;
  stage: InboundStage;
  next_action_at: string;
  source: string;
  created_at: string;
  updated_at: string;
  saved_to_supabase?: boolean;
}

export type InboundLeadForm = Omit<InboundLead, "id" | "created_at" | "updated_at" | "source" | "saved_to_supabase">;
export type DisplayBucket = "new" | "quoted" | "follow_up" | "closed";

const STORAGE_KEY = "apex:inbound-leads:v1";
const DRAFT_KEY = "apex:inbound-leads:active-draft:v1";

export const QUICK_FACTS = [
  "Married", "Has kids", "Owns home", "Smoker",
  "Pre-existing condition", "Wants no exam", "Veteran",
] as const;

export const BUCKETS: Array<{ key: DisplayBucket; label: string; stages: InboundStage[]; canonical: InboundStage }> = [
  { key: "new", label: "New", stages: ["new", "diagnosing"], canonical: "new" },
  { key: "quoted", label: "Quoted", stages: ["quoted"], canonical: "quoted" },
  { key: "follow_up", label: "Follow-up", stages: ["follow_up"], canonical: "follow_up" },
  { key: "closed", label: "Closed", stages: ["won", "lost"], canonical: "won" },
];

export const bucketOf = (stage: InboundStage): DisplayBucket =>
  stage === "diagnosing" ? "new" : stage === "won" || stage === "lost" ? "closed" : (stage as DisplayBucket);

export const PROBLEM_OPTIONS = [
  "Final expense",
  "Mortgage protection",
  "Life insurance review",
  "Retirement / IUL",
  "Child coverage",
  "Debt protection",
  "Existing policy issue",
  "Business protection",
  "Change bank",
  "Add beneficiary",
  "Other",
];

export const EMPTY_FORM: InboundLeadForm = {
  client_first_name: "",
  client_last_name: "",
  phone: "",
  email: "",
  state: "",
  city: "",
  problem_type: "",
  urgency: "normal",
  current_coverage: "",
  desired_solution: "",
  budget: "",
  household: "",
  notes: "",
  transcript: "",
  stage: "new",
  next_action_at: "",
};

const STATE_ALIASES: Record<string, string> = {
  alabama: "AL", alaska: "AK", arizona: "AZ", arkansas: "AR", california: "CA",
  colorado: "CO", connecticut: "CT", delaware: "DE", florida: "FL", georgia: "GA",
  hawaii: "HI", idaho: "ID", illinois: "IL", indiana: "IN", iowa: "IA", kansas: "KS",
  kentucky: "KY", louisiana: "LA", maine: "ME", maryland: "MD", massachusetts: "MA",
  michigan: "MI", minnesota: "MN", mississippi: "MS", missouri: "MO", montana: "MT",
  nebraska: "NE", nevada: "NV", "new hampshire": "NH", "new jersey": "NJ",
  "new mexico": "NM", "new york": "NY", "north carolina": "NC", "north dakota": "ND",
  ohio: "OH", oklahoma: "OK", oregon: "OR", pennsylvania: "PA", "rhode island": "RI",
  "south carolina": "SC", "south dakota": "SD", tennessee: "TN", texas: "TX",
  utah: "UT", vermont: "VT", virginia: "VA", washington: "WA", "west virginia": "WV",
  wisconsin: "WI", wyoming: "WY",
};

const ALL_STATE_ABBR =
  "AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY";

const AREA_CODE_STATE: Record<string, string> = {
  "201":"NJ","202":"DC","203":"CT","205":"AL","206":"WA","207":"ME","208":"ID","209":"CA","210":"TX","212":"NY","213":"CA","214":"TX","215":"PA","216":"OH","217":"IL","218":"MN","219":"IN",
  "224":"IL","225":"LA","228":"MS","229":"GA","231":"MI","234":"OH","239":"FL","240":"MD","248":"MI","251":"AL","252":"NC","253":"WA","254":"TX","256":"AL","260":"IN","262":"WI","267":"PA","269":"MI","270":"KY","272":"PA","276":"VA","281":"TX",
  "301":"MD","302":"DE","303":"CO","304":"WV","305":"FL","307":"WY","308":"NE","309":"IL","310":"CA","312":"IL","313":"MI","314":"MO","315":"NY","316":"KS","317":"IN","318":"LA","319":"IA","320":"MN","321":"FL","323":"CA","325":"TX","330":"OH","331":"IL","334":"AL","336":"NC","337":"LA","339":"MA","341":"CA","346":"TX","347":"NY","351":"MA","352":"FL","360":"WA","361":"TX","364":"KY","380":"OH","385":"UT","386":"FL",
  "401":"RI","402":"NE","404":"GA","405":"OK","406":"MT","407":"FL","408":"CA","409":"TX","410":"MD","412":"PA","413":"MA","414":"WI","415":"CA","417":"MO","419":"OH","423":"TN","424":"CA","425":"WA","430":"TX","432":"TX","434":"VA","435":"UT","440":"OH","442":"CA","443":"MD","458":"OR","463":"IN","469":"TX","470":"GA","475":"CT","478":"GA","479":"AR","480":"AZ","484":"PA",
  "501":"AR","502":"KY","503":"OR","504":"LA","505":"NM","507":"MN","508":"MA","509":"WA","510":"CA","512":"TX","513":"OH","515":"IA","516":"NY","517":"MI","518":"NY","520":"AZ","530":"CA","531":"NE","534":"WI","539":"OK","540":"VA","541":"OR","551":"NJ","557":"MO","559":"CA","561":"FL","562":"CA","563":"IA","564":"WA","567":"OH","570":"PA","571":"VA","573":"MO","574":"IN","575":"NM","580":"OK","585":"NY","586":"MI","601":"MS","602":"AZ","603":"NH","605":"SD","606":"KY","607":"NY","608":"WI","609":"NJ","610":"PA","612":"MN","614":"OH","615":"TN","616":"MI","617":"MA","618":"IL","619":"CA","620":"KS","623":"AZ","626":"CA","628":"CA","629":"TN","630":"IL","631":"NY","636":"MO","640":"NJ","641":"IA","646":"NY","650":"CA","651":"MN","657":"CA","660":"MO","661":"CA","662":"MS","667":"MD","669":"CA","678":"GA","681":"WV","682":"TX","689":"FL",
  "701":"ND","702":"NV","703":"VA","704":"NC","706":"GA","707":"CA","708":"IL","712":"IA","713":"TX","714":"CA","715":"WI","716":"NY","717":"PA","718":"NY","719":"CO","720":"CO","724":"PA","725":"NV","727":"FL","731":"TN","732":"NJ","734":"MI","737":"TX","740":"OH","743":"NC","747":"CA","754":"FL","757":"VA","760":"CA","762":"GA","763":"MN","765":"IN","769":"MS","770":"GA","772":"FL","773":"IL","774":"MA","775":"NV","779":"IL","781":"MA","785":"KS","786":"FL",
  "801":"UT","802":"VT","803":"SC","804":"VA","805":"CA","806":"TX","808":"HI","810":"MI","812":"IN","813":"FL","814":"PA","815":"IL","816":"MO","817":"TX","818":"CA","828":"NC","830":"TX","831":"CA","843":"SC","845":"NY","847":"IL","848":"NJ","850":"FL","854":"SC","856":"NJ","857":"MA","858":"CA","859":"KY","860":"CT","862":"NJ","863":"FL","864":"SC","865":"TN","870":"AR","872":"IL","878":"PA","901":"TN","903":"TX","904":"FL","906":"MI","907":"AK","908":"NJ","909":"CA","910":"NC","912":"GA","913":"KS","914":"NY","915":"TX","916":"CA","917":"NY","918":"OK","919":"NC","920":"WI","925":"CA","928":"AZ","929":"NY","930":"IN","931":"TN","936":"TX","937":"OH","938":"AL","940":"TX","941":"FL","947":"MI","949":"CA","951":"CA","952":"MN","954":"FL","956":"TX","959":"CT","970":"CO","971":"OR","972":"TX","973":"NJ","978":"MA","979":"TX","980":"NC","984":"NC","985":"LA","989":"MI",
};

export function loadDraft(): InboundLeadForm | null {
  if (typeof window === "undefined" || !window.localStorage) return null;
  try {
    const raw = window.localStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return typeof parsed === "object" && parsed && "client_first_name" in parsed ? parsed : null;
  } catch {
    return null;
  }
}

export function saveDraft(form: InboundLeadForm) {
  if (typeof window === "undefined" || !window.localStorage) return;
  try {
    const hasContent = Object.values(form).some((value) => typeof value === "string" && value.trim().length > 0);
    if (hasContent) window.localStorage.setItem(DRAFT_KEY, JSON.stringify(form));
    else window.localStorage.removeItem(DRAFT_KEY);
  } catch {}
}

export function clearDraft() {
  if (typeof window === "undefined" || !window.localStorage) return;
  try {
    window.localStorage.removeItem(DRAFT_KEY);
  } catch {}
}

export function appendNote(notes: string, fact: string): string {
  const existing = notes.split(/[·\n]/).map((value) => value.trim()).filter(Boolean);
  if (existing.includes(fact)) return existing.filter((value) => value !== fact).join(" · ");
  return existing.length === 0 ? fact : `${existing.join(" · ")} · ${fact}`;
}

export function fmtCallTimer(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${minutes}:${remainder.toString().padStart(2, "0")}`;
}

export function inferStateFromPhone(phone: string): string | null {
  const digits = phone.replace(/\D/g, "");
  const area = digits.length === 11 && digits.startsWith("1")
    ? digits.slice(1, 4)
    : digits.length === 10
      ? digits.slice(0, 3)
      : digits.length >= 3
        ? digits.slice(0, 3)
        : null;
  return area ? AREA_CODE_STATE[area] ?? null : null;
}

export function formatPhone(value: string): string {
  const digits = value.replace(/\D/g, "");
  if (digits.length <= 3) return digits;
  if (digits.length <= 6) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`;
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6, 10)}`;
}

export function loadLocalLeads(): InboundLead[] {
  if (typeof window === "undefined" || !window.localStorage) return [];
  try {
    const parsed = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveLocalLeads(leads: InboundLead[]) {
  if (typeof window === "undefined" || !window.localStorage) return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(leads.slice(0, 300)));
  } catch {}
}

export function createId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `local-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function leadName(lead: Pick<InboundLead, "client_first_name" | "client_last_name">): string {
  return [lead.client_first_name, lead.client_last_name].filter(Boolean).join(" ") || "Unnamed caller";
}

export function applyTranscriptHints(transcript: string, current: InboundLeadForm): InboundLeadForm {
  const text = transcript.toLowerCase();
  const next = { ...current, transcript };
  const email = transcript.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0];
  if (email && !next.email) next.email = email.toLowerCase();

  const phone = transcript.match(/(?:\+?1[\s.-]?)?(?:\(?\d{3}\)?[\s.-]?)\d{3}[\s.-]?\d{4}/)?.[0];
  if (phone && !next.phone) next.phone = formatPhone(phone);

  const namePatterns = [
    /(?:my\s+name\s+is|name\s+is|this\s+is|client\s+is|caller\s+is|i'?m|it'?s)\s+([A-Z][a-z]+)(?:\s+([A-Z][a-z]+))?/,
    /(?:calling\s+for|for)\s+([A-Z][a-z]+)(?:\s+([A-Z][a-z]+))?/,
  ];
  for (const pattern of namePatterns) {
    const match = transcript.match(pattern);
    if (!match) continue;
    if (!next.client_first_name) next.client_first_name = match[1] || "";
    if (!next.client_last_name && match[2]) next.client_last_name = match[2];
    if (match[1]) break;
  }

  for (const [name, abbr] of Object.entries(STATE_ALIASES)) {
    if (!next.state && text.includes(name)) {
      next.state = abbr;
      break;
    }
  }
  if (!next.state) {
    const stateAbbr = transcript.match(new RegExp(`\\b(${ALL_STATE_ABBR})\\b`));
    if (stateAbbr) next.state = stateAbbr[1];
  }

  if (!next.city) {
    const cityMatch =
      transcript.match(/(?:in|from|live\s+in|based\s+in)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)(?:,|\s|\.|$)/) ||
      transcript.match(/([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?),\s*(?:[A-Z]{2}|\w+)/);
    if (cityMatch?.[1] && cityMatch[1].length < 30) next.city = cityMatch[1];
  }

  if (!next.budget) {
    const monthly = transcript.match(/\$?\b(\d{2,4})\b\s*(?:dollars|bucks)?\s*(?:a\s+month|monthly|per\s+month|\/mo|\/month)/i);
    const lumpSum = transcript.match(/(?:budget|spend|afford|paying)\s+(?:up\s+to\s+|around\s+|about\s+)?\$?(\d{2,5})/i);
    if (monthly) next.budget = `$${monthly[1]}/mo`;
    else if (lumpSum) next.budget = `$${lumpSum[1]}`;
  }

  if (!next.problem_type) {
    const scores: Record<string, number> = {};
    const cat = (key: string, weight = 1) => { scores[key] = (scores[key] || 0) + weight; };
    if (/\b(mortgage|home\s*loan|house\s*payment)\b/.test(text)) cat("Mortgage protection", 2);
    if (/\b(final\s*expense|burial|funeral|cremation|cover\s+my\s+funeral)\b/.test(text)) cat("Final expense", 2);
    if (/\b(retirement|iul|index(ed)?\s*universal|401\s*k|roth|ira|annuity)\b/.test(text)) cat("Retirement / IUL", 2);
    if (/\b(child|children|kid|kids|grandkid|grandchild)\b/.test(text)) cat("Child coverage");
    if (/\b(business|llc|s-?corp|company|partner)\b/.test(text)) cat("Business protection");
    if (/\b(policy|coverage|insur\w+)\b/.test(text)) cat("Life insurance review");
    if (/\b(debt|credit\s*card|loan|owe)\b/.test(text)) cat("Debt protection");
    if (/\b(existing|already\s+have|current\s+policy|review\s+my\s+policy|cancel)\b/.test(text)) cat("Existing policy issue");
    const top = Object.entries(scores).sort((a, b) => b[1] - a[1])[0];
    if (top && top[1] > 0) next.problem_type = top[0];
  }

  if (!next.current_coverage) {
    if (/\b(no\s+coverage|no\s+insurance|don'?t\s+have\s+(?:any\s+)?(?:coverage|insurance|policy)|never\s+had\s+(?:coverage|insurance))\b/.test(text)) {
      next.current_coverage = "No current coverage";
    } else if (/\b(already\s+have|existing\s+policy|got\s+a\s+policy|currently\s+covered|with\s+\w+(?:\s+insurance|\s+life))\b/.test(text)) {
      next.current_coverage = "Has existing coverage";
    } else if (/\b(group\s+(?:life|coverage)|through\s+work|employer\s+plan|company\s+plan)\b/.test(text)) {
      next.current_coverage = "Group/employer plan only";
    }
  }

  if (!next.household) {
    const bits: string[] = [];
    if (/\b(married|wife|husband|spouse)\b/.test(text)) bits.push("married");
    else if (/\b(single|divorced|widow(?:ed|er)?)\b/.test(text)) bits.push(text.match(/\b(single|divorced|widow(?:ed|er)?)\b/)![1]);
    const kidMatch = text.match(/\b(\d+|one|two|three|four|five)\s+(?:kid|kids|child|children|grandkid)/);
    if (kidMatch) bits.push(`${kidMatch[1]} ${kidMatch[1] === "1" || kidMatch[1] === "one" ? "kid" : "kids"}`);
    if (bits.length) next.household = bits.join(", ");
  }

  if (!next.next_action_at) {
    const followup = transcript.match(/(?:call\s+(?:me\s+)?back|follow(?:\s+up)?|reach\s+out)\s+(?:on\s+|by\s+|next\s+)?(\w+(?:\s+at\s+[\d:]+\s*(?:am|pm)?)?)/i);
    if (followup?.[1]) next.next_action_at = followup[1].slice(0, 60);
  }

  if (/\b(urgent|asap|right\s+away|today|tonight|emergency|immediately)\b/.test(text)) next.urgency = "hot";
  else if (/\b(this\s+week|soon|few\s+days|by\s+(?:monday|tuesday|wednesday|thursday|friday)|in\s+the\s+next\s+(?:couple|few)\s+days)\b/.test(text)) next.urgency = "warm";
  else if (next.urgency === undefined as unknown as string) next.urgency = "normal";

  return next;
}
