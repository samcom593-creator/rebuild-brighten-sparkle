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
});
