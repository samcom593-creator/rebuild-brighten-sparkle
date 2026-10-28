# Grow motion review — 2026-10-28

Scope: the motion/sound files named in the GROW-CRAFT packet. Review standard: repository Emil design engineering, review-animations and animation-performance skills. Baseline is 61cc1a56. Measurements and production harness are in the ignored `.grow-harness/` directory. This review is not a release approval; final rendered measurements belong in the craft-pass report.

| Location | Rule | Before | After / fix | Evidence |
| --- | --- | --- | --- | --- |
| `src/components/ui/delight/CountUp.tsx` | Frequent operating actions should be immediate; counts must agree with lists | 520ms tween with React updates each frame, followed by 360ms bump | Render current finite value immediately; null/non-finite values show dash | `DelightLayer.test.tsx` exercises rapid 10 → 500 → 1 updates and NaN |
| `src/styles/delight.css`, rise-list | No repeated motion during keyboard search or queue switches | Every row animated; later rows delayed 400ms | Remove list entrance animation | Source comparison; final frame measurement pending |
| `src/styles/delight.css`, rise/bump | Sub-300ms UI | 320ms / 360ms | 200ms / 200ms | CSS source comparison |
| `src/styles/delight.css`, breathe | Avoid paint on every frame | Animated box-shadow | Opacity-only live indicator | CSS source comparison |
| `src/styles/delight.css`, ambient | No permanent promotion without measured benefit | Five permanent will-change hints | Let browser promote the CSS transform animation | Final frame measurement pending |
| `src/styles/delight.css`, lift | Hover requires a fine pointer | Hover capability only | Hover and pointer:fine | CSS source comparison |
| `src/lib/celebrate.ts` | No high-frequency or keyboard bursts | Routine save burst; no keyboard guard | Save stays still; keyboard focus and never-activated documents suppress bursts | Source review; real-device interaction remains unverified |
| `src/hooks/useSoundEffects.ts` | Sound requires a gesture and preference | Preference only; resume rejection unhandled | Require active browser user activation; catch resume rejection | Code review; delayed responses outside activation intentionally stay silent |
| `src/lib/soundPreference.ts` | Sound-off must hold in private mode | Storage failure always returned true | In-memory choice survives blocked storage | `soundPreference.test.ts` blocks getItem/setItem and verifies off/on |
| `src/components/celebrations/CelebrationProvider.tsx` | Remote events are not user gestures | Realtime event caused repeated confetti and sound | Keep existing success toast; remove unsolicited burst/audio | Source review |
| `src/hooks/useTop3Celebration.ts` | Ranking refresh is not a user gesture | Rank change played sound | Preserve rank transition signal without audio | Source review |
| `src/components/dashboard/ConfettiCelebration.tsx` | Cancel scheduled work on unmount | Untracked frame/timer and confetti worker | Cancel frame and completion timer; reset owned instance | Source review |

`tones.ts` remains a pure state-to-token mapping. `useSoundEnabled.ts` retains its external-store subscription. ToneBubble is decorative and labelled content stays outside it. Reveal retains its CSS entrance and reduced-motion handling; list reordering stays still. Existing canvas calls retain disableForReducedMotion. No new animation dependency, query, RPC or role gate.

Targeted command: `npx vitest run src/tests/components/DelightLayer.test.tsx src/tests/lib/soundPreference.test.ts` — 2 files, 11 tests passed. Desktop CPU throttling is not evidence of physical-phone GPU, keyboard or safe-area behavior. Approval remains withheld until the complete final crawl, speed comparison and self-refutation pass.
