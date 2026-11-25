import { useEffect, useState, type RefObject } from "react";

export function useNativeVideoRecovery(source: string, videoRef: RefObject<HTMLVideoElement>) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [source]);

  const retry = () => {
    const video = videoRef.current;
    if (!video) return;
    setFailed(false);
    video.load();
    // Keep load + play in the retry gesture so mobile browsers can enable audio.
    void video.play().catch((error: unknown) => {
      if (videoRef.current !== video) return;
      // A browser can require the native Play control, or cancel an obsolete
      // play promise after a source change. Neither is a broken recording.
      if (error instanceof DOMException && (error.name === "NotAllowedError" || error.name === "AbortError")) return;
      setFailed(true);
    });
  };

  return { failed, retry, onError: () => setFailed(true), onCanPlay: () => setFailed(false) };
}
