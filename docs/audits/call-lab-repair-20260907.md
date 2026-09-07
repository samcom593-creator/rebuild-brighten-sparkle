# Call Lab audit and repair

## Plan and scope
1. Trace scenario selection, microphone setup, turn capture, prospect replies, event persistence, ending, scoring, report retry and history.
2. Repair dropped turns, audio interruption, transcript-save races, stuck scoring, and raw Responses API parsing.
3. Add typed practice without microphone/browser voice dependencies, contextual Coach mode guidance, useful recovery actions, responsive layout and owner-scoped history.
4. Verify behavioral regression tests, full source checks/build, server type checks and authenticated production practice through the report.

## Findings and implementation
- Provider discarded speech while a request was in flight. Responses now queue serially through prospect playback.
- Interim results prematurely armed the final-turn timer. Partial speech now cancels the timer; finalized speech arms it.
- Browser speech cancel did not guarantee promise completion. Cancel now resolves independently of browser events.
- Old providers survived navigation/reconnect. Explicit disposal cancels requests, speech recognition, playback and audio resources.
- Mute suppressed prospect output as well as agent input. It now affects the agent microphone only.
- Scoring raced pending event writes and stopped after two batches. Serialized persistence drains every batch and refuses scoring on a save failure.
- Scoring failure permanently locked the finish guard. Explicit retry preserves the same call; reports expose failures.
- Typed practice bypasses microphone, recognition and voice playback while keeping the same prospect endpoint and report.
- Coach mode had no cue producer. It now shows the current objection's coaching principle or an opening prompt.
- Admin recent history included other users; history is now explicitly owner filtered. Scripted demos no longer count as personal bests.
- Responses HTTP output text was read from an SDK-only convenience field. Both turn and evaluator now extract message/output_text content. Reference: https://developers.openai.com/api/reference/typescript/resources/beta/subresources/responses/methods/create
- Transcript-read errors on the server previously became empty input; now they stop processing.

## Validation
- 1,032 unit tests passed, six existing TODOs; eight new behavior tests cover raw response decoding, interruption, turn queueing, disposal, persistence backlog and retry.
- All 81 core checks passed, including production build and existing TypeScript baseline guard.
- Deno check passed for call-lab-turn and call-lab-evaluate.
- Updated the prior Discord copy assertion to match the already-deployed truthful wording; it was the only unrelated existing unit failure.
- Both Call Lab server functions deployed with existing JWT settings and in-function authentication unchanged.
- Deployment credential is project-scoped, function-only, and expires in seven days. Stored outside the repository; no provider keys exposed to the browser.

## Limits
Typed practice does not measure vocal delivery. Real speech still depends on browser speech recognition, permissions and microphone quality. This does not record raw audio. Staff access/RLS, scoring rubric and saved historical reports are preserved. Built-in rules fallback remains explicitly labeled in reports if external evaluation is unavailable.
