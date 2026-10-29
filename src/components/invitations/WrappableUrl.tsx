import { Fragment } from "react";

/**
 * A URL that wraps at its slashes before anywhere else: a soft break after each "/" lets
 * "apex-financial.org/r/" end one line and the slug start the next, instead of cutting the
 * slug in half. The text content (what is copied or selected) is the URL, unchanged.
 */
export function WrappableUrl({ url }: { url: string }) {
  const parts = url.split("/");
  return (
    <>
      {parts.map((part, i) => (
        // stable-key-allow:parts-of-one-url-string (in order, never reordered, no state)
        <Fragment key={i}>
          {part}
          {i < parts.length - 1 && <>/<wbr /></>}
        </Fragment>
      ))}
    </>
  );
}
