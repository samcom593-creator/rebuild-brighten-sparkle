interface VideoPlaybackErrorProps {
  source: string;
  onRetry: () => void;
}

/** A failed recording must leave both recovery and the surrounding next step usable. */
export function VideoPlaybackError({ source, onRetry }: VideoPlaybackErrorProps) {
  let recordingUrl: string | null = null;
  try {
    const url = new URL(source, window.location.origin);
    if (url.protocol === "https:" || url.protocol === "http:") recordingUrl = url.href;
  } catch { // empty-catch-allow:media-link-validation — invalid sources get retry without an unsafe link.
    recordingUrl = null;
  }

  const actionClass = "inline-flex min-h-11 items-center justify-center rounded-md border border-border bg-background px-4 py-2 text-sm font-semibold text-foreground hover:bg-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary";
  return (
    <div role="alert" className="rounded-lg border border-border bg-muted/30 p-4 text-sm text-foreground">
      <p className="font-semibold">This video could not load.</p>
      <p className="mt-1 text-muted-foreground">Try again or open the recording directly.</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" onClick={onRetry} className={actionClass}>Retry video</button>
        {recordingUrl && <a href={recordingUrl} target="_blank" rel="noopener noreferrer" className={actionClass}>Open recording</a>}
      </div>
    </div>
  );
}
