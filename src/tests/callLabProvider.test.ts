import { afterEach, describe, expect, it, vi } from "vitest";
import { ComposedProvider } from "@/lib/callLab/providers";
import type { CallEvent } from "@/lib/callLab/events";

vi.mock("@/integrations/supabase/client", () => ({ supabase: { auth: { getSession: async () => ({ data: { session: { access_token: "test" } } }) } } }));
vi.mock("@/lib/callLab/audio", () => ({
  createMicGraph: vi.fn(), StreamPlayer: vi.fn(),
  speakWithBrowser: () => ({ done: Promise.resolve("ended"), cancel: vi.fn() }),
}));
vi.mock("@/lib/callLab/stt", () => ({ speechRecognitionSupported: () => false, SpeechToText: class { start() {} stop() {} } }));

afterEach(() => vi.unstubAllGlobals());
const options = (events: CallEvent[]) => ({ textOnly: true, sessionId: "session", mode: "practice" as const, mediaStream: null, audioContext: null, onEvent: (e: CallEvent) => events.push(e), startedAt: Date.now(), voice: {}, openingLine: "Hello?", objectionIdsByKey: {} });

describe("typed practice and turn lifecycle", () => {
  it("works without microphone or speech recognition and queues overlapping responses", async () => {
    let release!: (r: Response) => void;
    const requests: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
      if (url.includes("tts")) return new Response(null, { status: 503 });
      const body = JSON.parse(String(init.body)); requests.push(body.text);
      if (requests.length === 1) return new Promise<Response>(resolve => { release = resolve; });
      return Response.json({ turnId: "pt_2", text: "Tell me more", events: [] });
    }));
    const events: CallEvent[] = []; const provider = new ComposedProvider();
    await provider.connect(options(events));
    const first = provider.sendText("My name is Sam");
    await vi.waitFor(() => expect(requests).toHaveLength(1));
    await provider.sendText("What matters most to you?");
    expect(requests).toHaveLength(1);
    release(Response.json({ turnId: "pt_1", text: "Hello Sam", events: [] }));
    await first;
    expect(requests).toEqual(["My name is Sam", "What matters most to you?"]);
    expect(events.filter(e => e.type === "transcript.final" && e.speaker === "prospect")).toHaveLength(3);
    provider.dispose();
  });
  it("never plays or appends an answer after the session has been disposed", async () => {
    let release!: (r: Response) => void;
    vi.stubGlobal("fetch", vi.fn(async (url: string) => url.includes("tts") ? new Response(null, { status: 503 }) : new Promise<Response>(r => { release = r; })));
    const events: CallEvent[] = []; const provider = new ComposedProvider();
    await provider.connect(options(events));
    const response = provider.sendText("Hello");
    await vi.waitFor(() => expect(release).toBeTypeOf("function"));
    provider.dispose(); const count = events.length;
    release(Response.json({ turnId: "late", text: "Too late", events: [] }));
    await response;
    expect(events).toHaveLength(count);
  });
});
