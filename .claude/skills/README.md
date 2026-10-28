# Project skills

Installed 2026-10-28 so every Claude Code session on this repo (Sam's laptop and
cloud sessions alike) works from the same design and motion standards.

| Folder | Source | Version | License |
| --- | --- | --- | --- |
| `animate`, `animate-expo`, `animation-performance`, `animation-vocabulary`, `apple-design`, `ask-sonner`, `break-ui`, `emil-design-eng`, `find-animation-opportunities`, `improve-animations`, `mobile-native`, `pick-ui-library`, `prototype`, `review-animations`, `write-swift` | [emilkowalski/skill](https://github.com/emilkowalski/skill) via `npx skills add emilkowalski/skill` (pinned in `skills-lock.json` at the repo root) | lock hashes | MIT, see `LICENSE-emilkowalski-skill.txt` |
| `impeccable` | [pbakaus/impeccable](https://github.com/pbakaus/impeccable) `plugin/skills/impeccable` (what `npx impeccable install --project` lays down) | 4.8.0 (engine 0.1.18) | Apache-2.0, see `impeccable/LICENSE` and `impeccable/NOTICE.md` |

Update: `npx skills@latest update` for Emil's set, `npx impeccable update` for impeccable.

The impeccable launcher (`impeccable/scripts/impeccable`) downloads its engine
binary on first run; set `IMPECCABLE_BIN` to point at an already-installed
`@impeccable/cli-<os>-<arch>` binary when the network is restricted.
