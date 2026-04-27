# Mobile + Always-On Access

This repo runs a **24/7 cloud VS Code** via GitHub Codespaces. Your laptop can be off — the workspace stays alive in the cloud and auto-syncs every save + every 2 hours.

## How it works (one-line version)

`Edit → save → autosave daemon (in container) → commit + push to autosave/<branch> → never lose work, ever`.

Two safety nets:
1. **In-Codespace daemon** — runs continuously, watches the filesystem, commits on file change (debounced 20s) AND every 2 hours.
2. **GitHub Actions watchdog** — runs every 2 hours from GitHub's side, prunes stale `autosave/*` branches and pages a warning if no commits in 6 hours despite active branches.

Code lives on `autosave/<base-branch>` — never directly on `main`. You merge to `main` manually via PR when ready.

## First-time setup (5 min)

1. **Push this branch.** From your laptop:
   ```bash
   git push -u origin feat/codespaces-autosave
   ```
2. **Open the repo on github.com** → green **Code** button → **Codespaces** tab → **Create codespace on feat/codespaces-autosave**.
3. **Wait ~2 minutes.** The container builds. Extensions install. The autosave daemon starts.
4. **Verify.** In the Codespace terminal:
   ```bash
   cat /tmp/autosave-daemon.log
   ```
   You should see `autosave-daemon starting in /workspaces/...`.
5. Make a tiny edit, save, wait 20s, then run `git log --all --oneline | head -5` — you should see an `autosave[fs-debounce-20s]` commit on `autosave/feat/codespaces-autosave`.

After that, the Codespace stays warm for 30 days of inactivity (default GitHub policy). On day 31 it auto-stops; just reopen it and the daemon relaunches via `postStartCommand`.

## Daily use from your phone

### Option A — GitHub mobile app (best for browsing + tiny edits)
1. Install **GitHub** from the App Store / Play Store.
2. Sign in.
3. Open your repo → tap the **<>** code icon → tap any file → **Edit** (pencil).
4. Edits commit straight to whatever branch you're on. No Codespace required.
5. **Add to home screen** for one-tap access:
   - iOS Safari: open `https://github.com/samcom593-creator/rebuild-brighten-sparkle` → Share → **Add to Home Screen**.
   - Android Chrome: open the URL → ⋮ menu → **Add to Home screen**.

### Option B — Codespaces in mobile browser (full VS Code on phone)
1. From your phone browser, open: `https://github.com/codespaces`.
2. Tap your active codespace (or **Create codespace** if none running).
3. Wait ~10s → the full VS Code editor loads in the browser. Terminal, file tree, search, all of it.
4. **Pin to home screen** (same Add-to-Home-Screen flow above) using URL `https://github.com/codespaces` — opens straight to your codespace list.
5. **Pro tip:** GitHub also serves a phone-optimized URL: `https://<codespace-name>.github.dev` works as a PWA.

### Option C — github.dev (instant web editor, no Codespace)
1. Open the repo on github.com.
2. Press `.` (period) — or change the URL from `github.com/...` to `github.dev/...`.
3. You get a stripped VS Code (no terminal, no extensions that need a runtime, but full editing + git).
4. Best for: quick text fixes, README edits, viewing code on the go.

## Knowing it's working

| Check | Where | Expected |
|---|---|---|
| Autosave daemon alive | Codespace terminal: `cat /tmp/autosave-daemon.pid && kill -0 $(cat /tmp/autosave-daemon.pid) && echo OK` | `OK` |
| Recent commits | github.com → repo → branches dropdown → search `autosave/` | Commits in the last few hours |
| Watchdog runs | github.com → repo → **Actions** tab → **Codespaces Autosave Watchdog** | Green check every 2 hours |
| No silent stop | Watchdog will print a `::warning::` if no commits in 6h with active branches | Visible in Actions log |

## VS Code commands (mobile or desktop)

`Ctrl/Cmd + Shift + P` → type:
- `Tasks: Run Task → autosave: status` — check daemon
- `Tasks: Run Task → autosave: tail log` — live log
- `Tasks: Run Task → autosave: restart` — kick it back up
- `Tasks: Run Task → autosave: trigger commit` — force a commit now

## Merging autosave back to main

The daemon never touches `main`. When you want to promote autosave work:
```bash
git checkout main
git pull
git merge --no-ff autosave/feat/codespaces-autosave
git push
```
Or open a PR from the autosave branch on GitHub.

## Cost notes

- **GitHub Pro ($4/mo)** includes 90 hours/mo of 2-core Codespaces (sleeps when idle, billed only while running).
- **Storage**: 20 GB included.
- The daemon does NOT keep the Codespace artificially "active" — it idles between events. Default 30-min idle timeout still applies; the Codespace stops, the daemon dies cleanly, and `postStartCommand` relaunches it on next attach.
- To run truly 24/7 (no idle stop), set the codespace's idle timeout via `gh codespace edit` or in repo Codespaces settings, but expect higher hours usage.

## Disabling autosave

In the Codespace, set `AUTOSAVE_ENABLED=0` and restart. Or kill the daemon: `kill $(cat /tmp/autosave-daemon.pid)` — it won't auto-restart until next container start.

## Troubleshooting

- **No commits showing up?** Check `/tmp/autosave-daemon.log`. If it says "REFUSING to stage probable secret", you have a `.env`-like file with credentials in it. Add it to `.gitignore`.
- **`inotifywait: not found`?** `post-create.sh` should install it; rerun with `bash .devcontainer/post-create.sh`.
- **Watchdog warning every run?** Means your Codespace is stopped. Open it, the daemon auto-restarts, commits resume.
- **Pushing fails with auth error?** The Codespace inherits your GitHub token via `GITHUB_TOKEN` automatically — but if it can't push, run `gh auth status` in the Codespace terminal and re-auth if needed.
