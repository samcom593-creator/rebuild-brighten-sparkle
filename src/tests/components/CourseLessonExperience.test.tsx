import { fireEvent, render, screen, waitFor, act } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { CourseTranscript } from "@/components/course/CourseTranscript";
import { CourseVideoPlayer } from "@/components/course/CourseVideoPlayer";
import type { OnboardingModule } from "@/hooks/useOnboardingCourse";

const visualModule: OnboardingModule = {
  id: "lesson-2",
  order_index: 5,
  title: "Review calls",
  description: "Use call data to improve.",
  video_url: "https://www.awesomescreenshot.com/video/55930238?key=share-key",
  poster_url: null,
  video_parts: [],
  pass_threshold: 80,
  is_active: true,
  phase_key: "systems",
  duration_seconds: 179,
  learning_objectives: ["Find the call log"],
  transcript_segments: [
    { time: "0:00", text: "This source recording is silent." },
    { time: "0:20", text: "Open Reports, then Call Logs." },
  ],
  transcript_kind: "visual-notes",
  media_has_audio: false,
};

describe("field-course lesson media", () => {
  it("labels silent source media and keeps readable visual notes", () => {
    render(<CourseTranscript module={visualModule} />);
    expect(screen.getByText("Visual walkthrough notes")).toBeInTheDocument();
    expect(screen.getByText(/supplied screen recording has no voice track/i)).toBeInTheDocument();
    expect(screen.getByText("Open Reports, then Call Logs.")).toBeInTheDocument();
  });

  it("embeds supplied walkthroughs and persists a manual watched receipt", () => {
    const onProgressUpdate = vi.fn();
    const onVideoComplete = vi.fn();
    render(
      <CourseVideoPlayer
        videoUrl={visualModule.video_url}
        watchedPercent={0}
        onProgressUpdate={onProgressUpdate}
        onVideoComplete={onVideoComplete}
      />,
    );

    expect(screen.getByTitle(/systems walkthrough/i)).toHaveAttribute(
      "src",
      "https://www.awesomescreenshot.com/embed?id=55930238&shareKey=share-key&info=false",
    );
    fireEvent.click(screen.getByRole("button", { name: /mark watched/i }));
    expect(onProgressUpdate).toHaveBeenCalledWith(100);
    expect(onVideoComplete).toHaveBeenCalledTimes(1);
  });

  it("shows branded artwork and accessible controls for native lesson video", () => {
    render(
      <CourseVideoPlayer
        videoUrl="https://cdn.example.com/apex-script-mastery.mp4"
        posterUrl="https://cdn.example.com/apex-script-mastery.jpg"
        title="Script Mastery"
        watchedPercent={35}
        onProgressUpdate={vi.fn()}
        onVideoComplete={vi.fn()}
      />,
    );

    const video = screen.getByLabelText("Script Mastery video");
    expect(video).toHaveAttribute("poster", "https://cdn.example.com/apex-script-mastery.jpg");
    expect(video).toHaveAttribute("preload", "metadata");
    expect(screen.getByText("35% watched")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Watch at 1.5x" })).toBeInTheDocument();
  });

  it("presents long finished lessons as an ordered chapter experience", () => {
    render(
      <CourseVideoPlayer
        videoUrl="https://cdn.example.com/part-1.mp4"
        posterUrl="https://cdn.example.com/poster.jpg"
        title="Closer Operating System"
        videoParts={[
          { title: "The closer operating system", url: "https://cdn.example.com/part-1.mp4", duration_seconds: 240 },
          { title: "Emotional discipline", url: "https://cdn.example.com/part-2.mp4", duration_seconds: 240 },
        ]}
        watchedPercent={0}
        onProgressUpdate={vi.fn()}
        onVideoComplete={vi.fn()}
      />,
    );

    expect(screen.getByLabelText("Closer Operating System: The closer operating system video")).toHaveAttribute(
      "src",
      "https://cdn.example.com/part-1.mp4",
    );
    expect(screen.getByText("Lesson chapters")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /emotional discipline/i })).toBeDisabled();
  });

  it("resets native playback and persisted progress when the selected recording changes", () => {
    const save = vi.fn();
    const complete = vi.fn();
    const { rerender } = render(<CourseVideoPlayer videoUrl="https://cdn.example.com/first.mp4" title="First" watchedPercent={60} onProgressUpdate={save} onVideoComplete={complete} />);
    const first = screen.getByLabelText("First video") as HTMLVideoElement;
    Object.defineProperty(first, "duration", { value: 100, configurable: true });
    fireEvent.loadedMetadata(first);
    expect(first.currentTime).toBe(60);

    rerender(<CourseVideoPlayer videoUrl="https://cdn.example.com/second.mp4" title="Second" watchedPercent={0} onProgressUpdate={save} onVideoComplete={complete} />);
    const second = screen.getByLabelText("Second video") as HTMLVideoElement;
    expect(second).not.toBe(first);
    expect(screen.getByText("0% watched")).toBeInTheDocument();
    Object.defineProperty(second, "duration", { value: 100, configurable: true });
    fireEvent.loadedMetadata(second);
    second.currentTime = 10;
    fireEvent.timeUpdate(second);
    expect(save).toHaveBeenLastCalledWith(10);
    expect(complete).not.toHaveBeenCalled();
  });

  it("starts a new chapter sequence at its own first chapter", () => {
    const props = { watchedPercent: 100, onProgressUpdate: vi.fn(), onVideoComplete: vi.fn() };
    const oldParts = [1, 2, 3].map((index) => ({ title: `Old ${index}`, url: `https://cdn.example.com/old-${index}.mp4`, duration_seconds: 100 }));
    const nextParts = [1, 2].map((index) => ({ title: `New ${index}`, url: `https://cdn.example.com/new-${index}.mp4`, duration_seconds: 100 }));
    const { rerender } = render(<CourseVideoPlayer {...props} title="Old" videoUrl={oldParts[0].url} videoParts={oldParts} />);
    expect(screen.getByLabelText("Old: Old 3 video")).toBeInTheDocument();
    rerender(<CourseVideoPlayer {...props} watchedPercent={0} title="New" videoUrl={nextParts[0].url} videoParts={nextParts} />);
    expect(screen.getByLabelText("New: New 1 video")).toHaveAttribute("src", nextParts[0].url);
    expect(screen.getByRole("button", { name: /New 2/i })).toBeDisabled();
  });

  it("offers native recording recovery without awarding unwatched progress", async () => {
    const save = vi.fn();
    const complete = vi.fn();
    render(<CourseVideoPlayer videoUrl="https://cdn.example.com/lesson.mp4" title="Lesson" watchedPercent={0} onProgressUpdate={save} onVideoComplete={complete} />);
    const video = screen.getByLabelText("Lesson video") as HTMLVideoElement;
    const load = vi.spyOn(video, "load").mockImplementation(() => undefined);
    const play = vi.spyOn(video, "play").mockResolvedValue(undefined);
    fireEvent.error(video);
    expect(screen.getByRole("link", { name: "Open recording" })).toHaveAttribute("href", "https://cdn.example.com/lesson.mp4");
    fireEvent.click(screen.getByRole("button", { name: "Retry video" }));
    expect(load).toHaveBeenCalledOnce();
    expect(play).toHaveBeenCalledOnce();
    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
    expect(save).not.toHaveBeenCalled();
    expect(complete).not.toHaveBeenCalled();
  });

  it("retries a blocked YouTube API instead of leaving the loading screen indefinitely", async () => {
    const save = vi.fn();
    const complete = vi.fn();
    window.YT = undefined;
    render(<CourseVideoPlayer videoUrl="https://www.youtube.com/watch?v=abcdefghijk" watchedPercent={0} onProgressUpdate={save} onVideoComplete={complete} />);
    expect(screen.getByRole("status", { name: "Loading video" })).toBeInTheDocument();
    const first = document.querySelector<HTMLScriptElement>('script[src="https://www.youtube.com/iframe_api"]')!;
    expect(first).not.toBeNull();
    fireEvent.error(first);
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(screen.queryByRole("status", { name: "Loading video" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open recording" })).toHaveAttribute("href", "https://www.youtube.com/watch?v=abcdefghijk");
    fireEvent.click(screen.getByRole("button", { name: "Retry video" }));
    const second = document.querySelector<HTMLScriptElement>('script[src="https://www.youtube.com/iframe_api"]')!;
    expect(second).not.toBe(first);
    await act(async () => {
      window.YT = { Player: vi.fn().mockImplementation(function (_id, options) {
        options.events.onReady();
        return { destroy: vi.fn() };
      }) };
      window.onYouTubeIframeAPIReady?.();
    });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByRole("status", { name: "Loading video" })).not.toBeInTheDocument();
    expect(save).not.toHaveBeenCalled();
    expect(complete).not.toHaveBeenCalled();
  });

  it("bounds an iframe that never becomes ready even after the API has loaded", async () => {
    vi.useFakeTimers();
    window.YT = { Player: vi.fn().mockImplementation(function () { return { destroy: vi.fn() }; }) };
    const { unmount } = render(<CourseVideoPlayer videoUrl="https://www.youtube.com/watch?v=abcdefghijk" watchedPercent={0} onProgressUpdate={vi.fn()} onVideoComplete={vi.fn()} />);
    try {
      await act(async () => { await Promise.resolve(); });
      expect(screen.getByRole("status", { name: "Loading video" })).toBeInTheDocument();
      await act(async () => { await vi.advanceTimersByTimeAsync(12_000); });
      expect(screen.getByRole("alert")).toBeInTheDocument();
      expect(screen.queryByRole("status", { name: "Loading video" })).not.toBeInTheDocument();
    } finally {
      unmount();
      vi.useRealTimers();
      window.YT = undefined;
    }
  });
});
