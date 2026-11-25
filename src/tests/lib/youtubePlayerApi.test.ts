import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers();
  window.YT = undefined;
  window.onYouTubeIframeAPIReady = undefined;
  document.querySelectorAll('script[src="https://www.youtube.com/iframe_api"]').forEach((script) => script.remove());
});
afterEach(() => {
  vi.useRealTimers();
  window.YT = undefined;
  window.onYouTubeIframeAPIReady = undefined;
});

describe("YouTube API loading", () => {
  it("bounds a blocked request, shares in-flight work, and permits a fresh retry", async () => {
    const { loadYouTubeAPI, YOUTUBE_PLAYER_TIMEOUT_MS } = await import("@/lib/youtubePlayerApi");
    const first = loadYouTubeAPI();
    expect(loadYouTubeAPI()).toBe(first);
    const failure = first.catch((error: Error) => error);
    expect(document.querySelectorAll('script[src="https://www.youtube.com/iframe_api"]')).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(YOUTUBE_PLAYER_TIMEOUT_MS);
    expect(await failure).toBeInstanceOf(Error);
    expect(document.querySelector('script[src="https://www.youtube.com/iframe_api"]')).toBeNull();

    const retry = loadYouTubeAPI();
    expect(retry).not.toBe(first);
    window.YT = { Player: vi.fn() };
    window.onYouTubeIframeAPIReady?.();
    await expect(retry).resolves.toBeUndefined();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("rejects a script error and preserves an existing ready callback", async () => {
    const previous = vi.fn();
    window.onYouTubeIframeAPIReady = previous;
    const { loadYouTubeAPI } = await import("@/lib/youtubePlayerApi");
    const failed = loadYouTubeAPI();
    const failure = failed.catch((error: Error) => error);
    document.querySelector('script[src="https://www.youtube.com/iframe_api"]')!.dispatchEvent(new Event("error"));
    expect(await failure).toBeInstanceOf(Error);
    expect(window.onYouTubeIframeAPIReady).toBe(previous);
    const retry = loadYouTubeAPI();
    window.YT = { Player: vi.fn() };
    window.onYouTubeIframeAPIReady?.();
    await retry;
    expect(previous).toHaveBeenCalledOnce();
  });
});
