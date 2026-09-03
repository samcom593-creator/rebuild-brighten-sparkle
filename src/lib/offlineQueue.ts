// A durable outbox for writes that must survive a dead network, a reload, or a
// closed laptop.
//
// WHY THIS EXISTS: an agent posts a deal from a phone in a parking lot, the
// request fails, and the deal is gone. The draft survived in localStorage but
// the SUBMIT did not, so the agent believes they posted and the ledger never
// sees it — the same shape as an agent showing zero production on the very
// screens used to judge them.
//
// REPLAY SAFETY IS NOT ASSUMED, IT IS REQUIRED. Retrying a write is only safe
// when the server can recognise the retry. `submit_apex_deal(p_idempotency_key
// uuid, ...)` was verified against the live database to take an idempotency key
// and to answer `already_recorded` rather than inserting a second row. So this
// queue REFUSES to accept an entry without an idempotency key rather than
// quietly enabling a double-post. If you add a new queued operation, give it a
// server-side idempotency key FIRST, or do not queue it.
//
// WHAT THIS DELIBERATELY DOES NOT DO: it never reports a queued write as a
// completed one. A queued deal is "waiting to send", never "saved". Calling a
// pending write a success is the exact failure this codebase has paid for
// repeatedly (465 fake-success InsuraCloud rows, 198 AgentLink zombie syncs).

const STORAGE_KEY = "apex.offline.outbox.v1";

/** Stop one wedged entry from growing without bound. Past this it is parked,
 *  still readable, never silently dropped. */
export const MAX_ATTEMPTS = 8;

/** Bound the outbox so a long offline stretch cannot fill the storage quota
 *  and take the rest of the app down with it. */
export const MAX_ENTRIES = 50;

/** Operations allowed in the outbox. Each one MUST be idempotent server-side. */
export type QueuedKind = "submit_apex_deal";

export type QueuedEntry = {
  /** Local row id — not the server's. */
  id: string;
  /** Prevents one signed-in user from replaying another user's device-local
   * outbox after an account switch on a shared browser. */
  ownerUserId: string;
  kind: QueuedKind;
  /** The server-side idempotency key. Replaying with the same key is what makes
   *  this queue safe; without it we would be inventing duplicate production. */
  idempotencyKey: string;
  args: Record<string, unknown>;
  createdAt: string;
  attempts: number;
  lastError: string | null;
  /** A human label so the UI can say WHICH deal is waiting, not just "1 item". */
  label: string;
};

export type FlushOutcome = {
  sent: number;
  failed: number;
  remaining: number;
  /** True only when there was nothing to do. Distinguished from "tried and all
   *  failed" so a caller can never render an empty queue as a successful send. */
  idle: boolean;
};

type Listener = (entries: QueuedEntry[]) => void;

const listeners = new Set<Listener>();

function hasStorage(): boolean {
  try {
    return typeof window !== "undefined" && !!window.localStorage;
  } catch (error) {
    // Private-mode Safari throws on property access. Report it as absent
    // rather than crashing the caller.
    void error;
    return false;
  }
}

export function readQueue(): QueuedEntry[] {
  if (!hasStorage()) return [];
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(STORAGE_KEY);
  } catch (error) {
    void error;
    return [];
  }
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    // A corrupt or half-written row must not take the whole outbox with it.
    return parsed.filter((row): row is QueuedEntry => {
      if (!row || typeof row !== "object") return false;
      const candidate = row as Partial<QueuedEntry>;
      return (
        typeof candidate.id === "string" &&
        typeof candidate.ownerUserId === "string" &&
        candidate.ownerUserId.length > 0 &&
        typeof candidate.idempotencyKey === "string" &&
        candidate.idempotencyKey.length > 0 &&
        typeof candidate.kind === "string" &&
        !!candidate.args
      );
    });
  } catch (error) {
    void error;
    return [];
  }
}

function writeQueue(entries: QueuedEntry[]): boolean {
  if (!hasStorage()) return false;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  } catch (error) {
    // Quota exceeded, or storage disabled. The caller must be told the write
    // did NOT persist so it can refuse to promise the user a retry.
    void error;
    return false;
  }
  for (const listener of listeners) listener(entries);
  return true;
}

export function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  listener(readQueue());
  return () => {
    listeners.delete(listener);
  };
}

export function queueSize(): number {
  return readQueue().length;
}

export function readQueueForUser(ownerUserId: string): QueuedEntry[] {
  return readQueue().filter((entry) => entry.ownerUserId === ownerUserId);
}

/** True when the browser believes it is offline. `navigator.onLine` only ever
 *  proves the NEGATIVE reliably — online can still mean a captive portal — so
 *  this is used to decide when to queue, never to declare a send succeeded. */
export function isOffline(): boolean {
  if (typeof navigator === "undefined") return false;
  return navigator.onLine === false;
}

/**
 * Did this failure happen because the write never reached the server?
 *
 * This is the ONLY question that decides whether a failed write is safe to
 * queue. A transport failure means the server never judged the request, so a
 * retry is honest. A server-side rejection ("premium is required") means the
 * server DID judge it, and retrying the identical payload forever is a queue
 * that never drains.
 *
 * Deliberately conservative: anything not recognised as transport is treated as
 * a real server answer and is NOT queued. Wrongly queueing shows the agent a
 * pending deal that can never send; wrongly not queueing shows them the true
 * error they can act on. The second failure is the cheaper one.
 */
export function isTransportError(error: unknown): boolean {
  if (isOffline()) return true;
  const message = (
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : error && typeof error === "object" && "message" in error
          ? String((error as { message?: unknown }).message ?? "")
          : ""
  ).toLowerCase();
  if (!message) return false;
  return (
    message.includes("failed to fetch") ||
    message.includes("networkerror") ||
    message.includes("network request failed") ||
    message.includes("load failed") ||
    message.includes("fetch failed") ||
    message.includes("err_internet_disconnected") ||
    message.includes("err_network") ||
    message.includes("timeout") ||
    message.includes("timed out") ||
    message.includes("connection")
  );
}

export type EnqueueResult =
  | { ok: true; entry: QueuedEntry }
  | { ok: false; reason: "no-idempotency-key" | "queue-full" | "storage-unavailable" };

export function enqueue(input: {
  ownerUserId: string;
  kind: QueuedKind;
  idempotencyKey: string;
  args: Record<string, unknown>;
  label: string;
}): EnqueueResult {
  // The invariant that makes replay safe. Refuse rather than risk a duplicate
  // policy landing in the book commissions are computed from.
  if (!input.ownerUserId || !input.idempotencyKey || !input.idempotencyKey.trim()) {
    return { ok: false, reason: "no-idempotency-key" };
  }
  const current = readQueue();

  // Same idempotency key already waiting: this is a re-submit of the same deal,
  // not a second deal. Refresh it in place instead of stacking copies.
  const existing = current.find(
    (row) => row.ownerUserId === input.ownerUserId && row.idempotencyKey === input.idempotencyKey,
  );
  if (existing) {
    const updated = current.map((row) =>
      row.ownerUserId === input.ownerUserId && row.idempotencyKey === input.idempotencyKey
        ? { ...row, args: input.args, label: input.label, lastError: null }
        : row,
    );
    if (!writeQueue(updated)) return { ok: false, reason: "storage-unavailable" };
    return {
      ok: true,
      entry: updated.find(
        (row) => row.ownerUserId === input.ownerUserId && row.idempotencyKey === input.idempotencyKey,
      ) as QueuedEntry,
    };
  }

  if (current.length >= MAX_ENTRIES) return { ok: false, reason: "queue-full" };

  const entry: QueuedEntry = {
    id: `q_${input.ownerUserId}_${input.idempotencyKey}`,
    ownerUserId: input.ownerUserId,
    kind: input.kind,
    idempotencyKey: input.idempotencyKey,
    args: input.args,
    createdAt: new Date().toISOString(),
    attempts: 0,
    lastError: null,
    label: input.label,
  };
  if (!writeQueue([...current, entry])) return { ok: false, reason: "storage-unavailable" };
  return { ok: true, entry };
}

export function removeEntry(id: string): void {
  writeQueue(readQueue().filter((row) => row.id !== id));
}

export function clearQueue(): void {
  writeQueue([]);
}

/** An entry that has burned through MAX_ATTEMPTS is parked, not deleted. It
 *  still shows in the UI so a stuck deal is visible instead of vanishing. */
export function isParked(entry: QueuedEntry): boolean {
  return entry.attempts >= MAX_ATTEMPTS;
}

export type SendResult = { ok: true } | { ok: false; error: string; permanent?: boolean };

/**
 * Drain the outbox through `send`. Entries are removed ONLY on a definite
 * success, or on a definite permanent rejection (which the server has already
 * judged — e.g. validation the retry can never satisfy). Anything ambiguous
 * stays queued, because dropping a write we cannot prove landed is the same
 * lie as recording one that never did.
 */
export async function flushQueue(
  send: (entry: QueuedEntry) => Promise<SendResult>,
  ownerUserId?: string,
): Promise<FlushOutcome> {
  const belongsToUser = (row: QueuedEntry) => !ownerUserId || row.ownerUserId === ownerUserId;
  const pending = readQueue().filter((row) => belongsToUser(row) && !isParked(row));
  if (pending.length === 0) {
    return { sent: 0, failed: 0, remaining: readQueue().filter(belongsToUser).length, idle: true };
  }

  let sent = 0;
  let failed = 0;

  for (const entry of pending) {
    // Re-read each iteration: a concurrent tab may have drained this already.
    const live = readQueue().find((row) => row.id === entry.id);
    if (!live) continue;

    let result: SendResult;
    try {
      result = await send(live);
    } catch (error) {
      result = { ok: false, error: error instanceof Error ? error.message : String(error) };
    }

    if (result.ok) {
      removeEntry(live.id);
      sent += 1;
      continue;
    }

    failed += 1;
    if (result.permanent) {
      // The server has definitively refused it. Park it at the attempt ceiling
      // so it stops retrying but stays visible for a human.
      writeQueue(
        readQueue().map((row) =>
          row.id === live.id ? { ...row, attempts: MAX_ATTEMPTS, lastError: result.error } : row,
        ),
      );
      continue;
    }
    writeQueue(
      readQueue().map((row) =>
        row.id === live.id ? { ...row, attempts: row.attempts + 1, lastError: result.error } : row,
      ),
    );
  }

  return { sent, failed, remaining: readQueue().filter(belongsToUser).length, idle: false };
}
