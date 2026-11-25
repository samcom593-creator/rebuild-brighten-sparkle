import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { focusManager, onlineManager, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PrivateAudioPlayer } from "@/components/calls/PrivateAudioPlayer";
import { CallAudioPlayer } from "@/components/calls/CallAudioPlayer";
import { ClientCallHistory } from "@/components/clients/ClientCallHistory";
import { TrainingRecordings } from "@/components/training/TrainingRecordings";

const auth = vi.hoisted(() => ({ user: { id: "user-a" } as { id: string } | null, isLoading: false }));
const db = vi.hoisted(() => ({ sign: vi.fn(), bucket: vi.fn(), rpc: vi.fn(), history: vi.fn(), invoke: vi.fn() }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => auth }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: db.rpc, storage: { from: db.bucket }, functions: { invoke: db.invoke } } }));
vi.mock("@/lib/looseSupabase", () => ({ looseSupabase: { rpc: db.history } }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const source = async () => ({ bucket: "readymode-audio" as const, path: "calls/private.mp3" });
const signed = (n: number) => ({ data: { signedUrl: `https://storage.example.test/private.mp3?token=secret-${n}` }, error: null });
function mount(content = <PrivateAudioPlayer sourceKey="call:a" resolveSource={source} />) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const wrapper = (children: React.ReactNode) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  return { client, wrapper, ...render(wrapper(content)) };
}
async function media() { return await screen.findByLabelText("Call recording") as HTMLAudioElement; }

beforeEach(() => {
  auth.user = { id: "user-a" };
  auth.isLoading = false;
  db.sign.mockReset(); db.bucket.mockReset(); db.rpc.mockReset(); db.history.mockReset(); db.invoke.mockReset();
  db.bucket.mockReturnValue({ createSignedUrl: db.sign });
  db.sign.mockImplementation(async () => signed(db.sign.mock.calls.length));
  db.invoke.mockImplementation(async () => ({ data: { signedUrl: signed(db.invoke.mock.calls.length).data.signedUrl, expiresInSeconds: 900, variant: "full" }, error: null }));
  vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => undefined);
  vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => undefined);
});
afterEach(() => { cleanup(); focusManager.setFocused(undefined); onlineManager.setOnline(true); vi.restoreAllMocks(); });

describe("private recording playback", () => {
  it("starts playback after the first compact Play click and metadata, without a second click", async () => {
    mount(<PrivateAudioPlayer sourceKey="call:a" resolveSource={source} compact playLabel="Play call" />);
    expect(db.sign).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Play call" }));
    const element = await media();
    expect(HTMLMediaElement.prototype.play).not.toHaveBeenCalled();
    fireEvent.loadedMetadata(element);
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(1);
    expect(element.currentTime).toBe(0);
  });

  it("does not re-sign or reset the recording on focus or network reconnection", async () => {
    const now = Date.now();
    const clock = vi.spyOn(Date, "now").mockReturnValue(now);
    mount();
    const element = await media();
    element.currentTime = 48;
    fireEvent.timeUpdate(element);
    clock.mockReturnValue(now + 3_600_001);
    await act(async () => {
      focusManager.setFocused(false); onlineManager.setOnline(false);
      focusManager.setFocused(true); onlineManager.setOnline(true);
      await Promise.resolve();
    });
    expect(await media()).toBe(element);
    expect(element.currentTime).toBe(48);
    expect(db.sign).toHaveBeenCalledTimes(1);
  });

  it("claims a timestamp request once when the same call appears in two panels", async () => {
    mount(<><CallAudioPlayer callId="call-a" compact /><CallAudioPlayer callId="call-a" compact /></>);
    act(() => window.dispatchEvent(new CustomEvent("call-audio-seek", { detail: { callId: "call-a", seconds: 60 } })));
    const element = await media();
    expect(screen.getAllByLabelText("Call recording")).toHaveLength(1);
    expect(db.invoke).toHaveBeenCalledTimes(1);
    fireEvent.loadedMetadata(element);
    expect(element.currentTime).toBe(57);
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(1);
  });

  it("pauses the other recording when a second native player starts", async () => {
    mount(<><PrivateAudioPlayer sourceKey="call:a" resolveSource={source} /><PrivateAudioPlayer sourceKey="call:b" resolveSource={source} /></>);
    await waitFor(() => expect(screen.getAllByLabelText("Call recording")).toHaveLength(2));
    const [first, second] = screen.getAllByLabelText("Call recording") as HTMLAudioElement[];
    fireEvent.play(first);
    const pauseFirst = vi.spyOn(first, "pause");
    fireEvent.play(second);
    expect(pauseFirst).toHaveBeenCalledTimes(1);
  });

  it("does not reset another instance of the same recording when one link is renewed", async () => {
    mount(<><PrivateAudioPlayer sourceKey="call:a" resolveSource={source} /><PrivateAudioPlayer sourceKey="call:a" resolveSource={source} /></>);
    await waitFor(() => expect(screen.getAllByLabelText("Call recording")).toHaveLength(2));
    const [first, second] = screen.getAllByLabelText("Call recording") as HTMLAudioElement[];
    const secondUrl = second.src;
    second.currentTime = 23;
    fireEvent.timeUpdate(second);
    fireEvent.error(first);
    await waitFor(() => expect(db.sign).toHaveBeenCalledTimes(3));
    await waitFor(() => expect(screen.getAllByLabelText("Call recording")[0]).toHaveAttribute("src", signed(3).data.signedUrl));
    expect(screen.getAllByLabelText("Call recording")[1]).toBe(second);
    expect(second.src).toBe(secondUrl);
    expect(second.currentTime).toBe(23);
  });

  it("reports playback only after a real playing event, never after a click or metadata alone", async () => {
    const onPlay = vi.fn();
    mount(<PrivateAudioPlayer sourceKey="call:a" resolveSource={source} compact onPlay={onPlay} />);
    fireEvent.click(screen.getByRole("button", { name: "Play recording" }));
    const element = await media();
    fireEvent.loadedMetadata(element);
    fireEvent.play(element);
    expect(onPlay).not.toHaveBeenCalled();
    fireEvent.playing(element);
    expect(onPlay).toHaveBeenCalledTimes(1);
  });

  it("shows a retry after signing denial without exposing a signed URL or backend details", async () => {
    db.sign.mockResolvedValueOnce({ data: null, error: { message: "permission denied private token=secret" } });
    mount();
    expect(await screen.findByRole("alert")).toHaveTextContent("The recording did not load");
    expect(screen.queryByLabelText("Call recording")).toBeNull();
    expect(document.body.textContent).not.toContain("token=secret");
    expect(db.sign).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Retry recording" }));
    expect(await media()).toHaveAttribute("src", signed(2).data.signedUrl);
  });

  it("re-signs once on a media failure, then stops and offers an explicit retry", async () => {
    mount();
    fireEvent.error(await media());
    await waitFor(() => expect(screen.getByLabelText("Call recording")).toHaveAttribute("src", signed(2).data.signedUrl));
    fireEvent.error(await media());
    expect(await screen.findByRole("alert")).toHaveTextContent("This recording could not play");
    expect(db.sign).toHaveBeenCalledTimes(2);
    fireEvent.error(await media());
    expect(db.sign).toHaveBeenCalledTimes(2);
    fireEvent.click(screen.getByRole("button", { name: "Retry recording" }));
    await waitFor(() => expect(screen.getByLabelText("Call recording")).toHaveAttribute("src", signed(3).data.signedUrl));
  });

  it("resumes an interrupted recording at its prior position after one fresh signature", async () => {
    mount();
    const first = await media();
    first.currentTime = 42;
    fireEvent.play(first);
    fireEvent.error(first);
    await waitFor(() => expect(screen.getByLabelText("Call recording")).toHaveAttribute("src", signed(2).data.signedUrl));
    const renewed = await media();
    fireEvent.loadedMetadata(renewed);
    expect(renewed.currentTime).toBe(42);
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(1);
  });

  it("recovers the last known position if the failed media element resets its clock to zero", async () => {
    mount();
    const first = await media();
    first.currentTime = 51;
    fireEvent.play(first);
    fireEvent.timeUpdate(first);
    first.currentTime = 0;
    fireEvent.error(first);
    await waitFor(() => expect(screen.getByLabelText("Call recording")).toHaveAttribute("src", signed(2).data.signedUrl));
    const renewed = await media();
    fireEvent.loadedMetadata(renewed);
    expect(renewed.currentTime).toBe(51);
  });

  it("preserves a paused position through recovery without starting unsolicited playback", async () => {
    mount();
    const first = await media();
    first.currentTime = 22;
    fireEvent.timeUpdate(first);
    fireEvent.pause(first);
    fireEvent.error(first);
    await waitFor(() => expect(screen.getByLabelText("Call recording")).toHaveAttribute("src", signed(2).data.signedUrl));
    const renewed = await media();
    fireEvent.loadedMetadata(renewed);
    expect(renewed.currentTime).toBe(22);
    expect(HTMLMediaElement.prototype.play).not.toHaveBeenCalled();
  });

  it("keeps only the latest requested moment while metadata is still loading", async () => {
    mount(<PrivateAudioPlayer sourceKey="call:a" resolveSource={source} moments={[{ t: "0:10", label: "First" }, { t: "0:30", label: "Second" }]} />);
    const element = await media();
    fireEvent.click(screen.getByRole("button", { name: /0:10 First/ }));
    fireEvent.click(screen.getByRole("button", { name: /0:30 Second/ }));
    fireEvent.loadedMetadata(element);
    expect(element.currentTime).toBe(27);
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(1);
  });

  it("keeps the snippet boundary through its own seek event and permits a manual seek to cancel it", async () => {
    mount(<PrivateAudioPlayer sourceKey="call:a" resolveSource={source} moments={[{ t: "1:00", label: "Objection" }]} />);
    const element = await media();
    Object.defineProperty(element, "readyState", { configurable: true, value: 1 });
    fireEvent.click(screen.getByRole("button", { name: /1:00 Objection/ }));
    fireEvent.seeking(element); fireEvent.seeked(element);
    element.currentTime = 102;
    fireEvent.timeUpdate(element);
    expect(HTMLMediaElement.prototype.pause).toHaveBeenCalledTimes(1);
    vi.mocked(HTMLMediaElement.prototype.pause).mockClear();
    fireEvent.click(screen.getByRole("button", { name: /1:00 Objection/ }));
    fireEvent.seeking(element); fireEvent.seeked(element);
    element.currentTime = 70;
    fireEvent.seeking(element); fireEvent.seeked(element);
    element.currentTime = 104;
    fireEvent.timeUpdate(element);
    expect(HTMLMediaElement.prototype.pause).not.toHaveBeenCalled();
  });

  it("catches a synchronous unsupported-media exception without logging the recording URL", async () => {
    vi.mocked(HTMLMediaElement.prototype.play).mockImplementationOnce(() => { throw new DOMException("private?token=secret", "NotSupportedError"); });
    mount(<PrivateAudioPlayer sourceKey="call:a" resolveSource={source} playOnLoad />);
    fireEvent.loadedMetadata(await media());
    expect(await screen.findByRole("alert")).toHaveTextContent("This recording could not play");
    expect(document.body.textContent).not.toContain("token=secret");
  });

  it("renews an expired URL before continuing playback from the same position", async () => {
    const now = Date.now();
    const clock = vi.spyOn(Date, "now").mockReturnValue(now);
    mount();
    const first = await media();
    first.currentTime = 73;
    clock.mockReturnValue(now + 3_600_001);
    fireEvent.play(first);
    await waitFor(() => expect(screen.getByLabelText("Call recording")).toHaveAttribute("src", signed(2).data.signedUrl));
    const renewed = await media();
    fireEvent.loadedMetadata(renewed);
    expect(renewed.currentTime).toBe(73);
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(1);
    expect(db.sign).toHaveBeenCalledTimes(2);
  });

  it("catches browser playback rejection and offers a direct user-gesture play button", async () => {
    vi.mocked(HTMLMediaElement.prototype.play).mockRejectedValueOnce(new DOMException("Blocked", "NotAllowedError"));
    mount(<PrivateAudioPlayer sourceKey="call:a" resolveSource={source} moments={[{ t: "1:00", label: "Objection" }]} />);
    const element = await media();
    Object.defineProperty(element, "readyState", { configurable: true, value: 1 });
    fireEvent.click(screen.getByRole("button", { name: /1:00 Objection/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Your browser paused playback");
    fireEvent.click(screen.getByRole("button", { name: "Play recording" }));
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(2);
    expect(db.sign).toHaveBeenCalledTimes(1);
  });

  it("removes the prior user's URL immediately and verifies access under the next account", async () => {
    let finish!: (value: ReturnType<typeof signed>) => void;
    const view = mount();
    const previous = await media();
    db.sign.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    auth.user = { id: "user-b" };
    view.rerender(view.wrapper(<PrivateAudioPlayer sourceKey="call:a" resolveSource={source} />));
    expect(screen.queryByLabelText("Call recording")).toBeNull();
    expect(HTMLMediaElement.prototype.pause).toHaveBeenCalled();
    await waitFor(() => expect(db.sign).toHaveBeenCalledTimes(2));
    await act(async () => finish(signed(2)));
    expect(await media()).not.toBe(previous);
    expect(await media()).toHaveAttribute("src", signed(2).data.signedUrl);
    expect(view.client.getQueriesData({ queryKey: ["private-recording", "user-b", "call:a"] })).toHaveLength(1);
  });

  it("does not request a URL when signed out or when call access returns no authorized copy", async () => {
    auth.user = null;
    const view = mount(<CallAudioPlayer callId="call-a" />);
    expect(screen.getByText("Sign in to play this recording.")).toBeInTheDocument();
    expect(db.invoke).not.toHaveBeenCalled();
    auth.user = { id: "user-a" };
    db.invoke.mockResolvedValue({ data: { recording: null }, error: null });
    view.rerender(view.wrapper(<CallAudioPlayer callId="call-a" />));
    expect(await screen.findByText("This call's recording is not published for your account yet.")).toBeInTheDocument();
    expect(db.sign).not.toHaveBeenCalled();
  });

  it("does not continue signing when an old account's source lookup completes after unmount", async () => {
    let finish!: (value: Awaited<ReturnType<typeof source>>) => void;
    const oldSource = vi.fn(() => new Promise<Awaited<ReturnType<typeof source>>>(resolve => { finish = resolve; }));
    const view = mount(<PrivateAudioPlayer sourceKey="call:a" resolveSource={oldSource} />);
    await waitFor(() => expect(oldSource).toHaveBeenCalledTimes(1));
    auth.user = null;
    view.rerender(view.wrapper(<PrivateAudioPlayer sourceKey="call:a" resolveSource={oldSource} />));
    await act(async () => finish(await source()));
    expect(db.sign).not.toHaveBeenCalled();
    expect(screen.queryByLabelText("Call recording")).toBeNull();
  });

  it.each([null, {}, [], { recording: null, signedUrl: "must-not-use" }, { signedUrl: "https://storage.example.test/a.mp3", expiresInSeconds: 900, variant: "unknown" }])("rejects an unverified call lookup instead of claiming no recording: %j", async data => {
    db.invoke.mockResolvedValue({ data, error: null });
    mount(<CallAudioPlayer callId="call-a" />);
    expect(await screen.findByRole("alert")).toHaveTextContent("The recording did not load");
    expect(db.sign).not.toHaveBeenCalled();
  });

  it("plays an authorized client-history call by callId without a provider URL or ReadyMode login", async () => {
    db.history.mockResolvedValue({ data: { client_id: "client-a", raw_provider_access: true, ambiguous_phone: false, next_cursor: null, calls: [{ key: "readymode:call-a", source_id: "call-a", source: "readymode", happened_at: "2026-11-24T16:00:00Z", category: "objection", outcome: "Bank Objection", duration_seconds: 120, transcript: null, audio_url: null, transcript_access: "not_available" }] }, error: null });
    mount(<ClientCallHistory clientId="client-a" />);
    fireEvent.click(await screen.findByRole("button", { name: "Play call" }));
    expect(await media()).toHaveAttribute("src", signed(1).data.signedUrl);
    expect(db.invoke).toHaveBeenCalledWith("readymode-recording-url", { body: { callId: "call-a" } });
    expect(db.bucket).not.toHaveBeenCalled();
    expect(db.sign).not.toHaveBeenCalled();
    expect(screen.queryByRole("link", { name: "Open recording" })).toBeNull();
  });

  it("lets a producer request an authorized muted copy while hiding restricted raw transcript and provider URL", async () => {
    db.history.mockResolvedValue({ data: { client_id: "client-a", raw_provider_access: false, ambiguous_phone: false, next_cursor: null, calls: [{ key: "readymode:call-a", source_id: "call-a", source: "readymode", happened_at: "2026-11-24T16:00:00Z", category: "objection", outcome: "Bank Objection", duration_seconds: 120, transcript: "Raw client details must remain hidden", audio_url: "https://provider.example.test/raw-private-call.mp3", transcript_access: "restricted" }] }, error: null });
    db.invoke.mockResolvedValue({ data: { signedUrl: signed(1).data.signedUrl, expiresInSeconds: 900, variant: "numbers_muted" }, error: null });
    mount(<ClientCallHistory clientId="client-a" />);
    fireEvent.click(await screen.findByRole("button", { name: "Play call" }));
    expect(await media()).toHaveAttribute("src", signed(1).data.signedUrl);
    expect(db.invoke).toHaveBeenCalledWith("readymode-recording-url", { body: { callId: "call-a" } });
    expect(db.sign).not.toHaveBeenCalled();
    expect(screen.getByText("Spoken numbers are muted for privacy.")).toBeInTheDocument();
    expect(screen.queryByText("Raw client details must remain hidden")).toBeNull();
    expect(screen.queryByRole("link", { name: "Open recording" })).toBeNull();
    expect(document.body.innerHTML).not.toContain("provider.example.test");
  });

  it("does not sign or expose a source when the client-history viewer has no authorized copy", async () => {
    db.history.mockResolvedValue({ data: { client_id: "client-a", raw_provider_access: false, ambiguous_phone: false, next_cursor: null, calls: [{ key: "readymode:call-a", source_id: "call-a", source: "readymode", happened_at: "2026-11-24T16:00:00Z", category: "objection", outcome: "Bank Objection", duration_seconds: 120, transcript: "Restricted raw transcript", audio_url: "https://provider.example.test/raw-private-call.mp3", transcript_access: "restricted" }] }, error: null });
    db.invoke.mockResolvedValue({ data: { recording: null }, error: null });
    mount(<ClientCallHistory clientId="client-a" />);
    fireEvent.click(await screen.findByRole("button", { name: "Play call" }));
    expect(await screen.findByText("This call's recording is not published for your account yet.")).toBeInTheDocument();
    expect(screen.queryByLabelText("Call recording")).toBeNull();
    expect(db.sign).not.toHaveBeenCalled();
    expect(document.body.innerHTML).not.toContain("provider.example.test");
    expect(screen.queryByText("Restricted raw transcript")).toBeNull();
  });

  it("uses the shared signed player for a published training recording", async () => {
    db.rpc.mockResolvedValue({ data: [{ id: "training-a", title: "Discovery example", presenter_id: "speaker-a", presenter_name: "Trainer", topic: "Discovery", description: null, recorded_on: "2026-11-24", duration_seconds: 120, audio_path: "training/safe.mp3", transcript: [{ t: 10, text: "A safe training excerpt." }] }], error: null });
    const view = mount(<TrainingRecordings />);
    fireEvent.click(await screen.findByRole("button", { name: /Discovery example/ }));
    expect(await media()).toHaveAttribute("src", signed(1).data.signedUrl);
    expect(db.invoke).toHaveBeenCalledWith("training-recording-url", { body: { recordingId: "training-a" } });
    expect(db.sign).not.toHaveBeenCalled();
    expect(db.bucket).not.toHaveBeenCalled();
    fireEvent.loadedMetadata(await media());
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(1);
    auth.user = null;
    view.rerender(view.wrapper(<TrainingRecordings />));
    expect(screen.queryByLabelText("Call recording")).toBeNull();
    expect(screen.queryByText("A safe training excerpt.")).toBeNull();
  });

  it.each([null, {}, [{ id: "broken", audio_path: "private.mp3" }]])("does not show an invalid training catalog as verified empty: %j", async data => {
    db.rpc.mockResolvedValue({ data, error: null });
    mount(<TrainingRecordings />);
    expect(await screen.findByText("The recordings did not load")).toBeInTheDocument();
    expect(screen.queryByText("No recordings yet")).toBeNull();
    expect(db.invoke).not.toHaveBeenCalled();
  });

  it("keeps a training signing denial retryable without attempting direct storage or exposing backend details", async () => {
    db.rpc.mockResolvedValue({ data: [{ id: "training-a", title: "Discovery example", presenter_id: null, presenter_name: null, topic: null, description: null, recorded_on: null, duration_seconds: null, audio_path: "training/safe.mp3", transcript: [] }], error: null });
    db.invoke.mockResolvedValueOnce({ data: null, error: { message: "secret catalog path" } });
    mount(<TrainingRecordings />);
    fireEvent.click(await screen.findByRole("button", { name: /Discovery example/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent("The recording did not load");
    expect(document.body.textContent).not.toContain("secret catalog path");
    expect(db.sign).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Retry recording" }));
    expect(await media()).toHaveAttribute("src", signed(2).data.signedUrl);
    expect(db.invoke).toHaveBeenCalledTimes(2);
  });
});
