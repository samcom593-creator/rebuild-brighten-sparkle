import { fireEvent, render, screen } from "@testing-library/react";
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
});
