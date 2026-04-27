# Codespaces autosave — TL;DR

Full instructions: [.devcontainer/MOBILE_ACCESS.md](.devcontainer/MOBILE_ACCESS.md)

**What this branch adds:** open the repo as a GitHub Codespace and your edits auto-commit + auto-push every save (debounced 20s) and every 2 hours, to `autosave/<branch>` — never `main`. Works from your phone via the GitHub mobile app or the Codespaces web editor. Laptop can be off.

**Bootstrap:**
1. `git push -u origin feat/codespaces-autosave`
2. github.com → repo → green Code button → Codespaces tab → Create on this branch
3. Wait ~2 min, edits begin auto-syncing

**Promote to main:** open a PR from `autosave/feat/codespaces-autosave` when ready.
