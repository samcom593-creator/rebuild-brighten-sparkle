// runner.mjs — launchd entry. Node must be the first process so its Full Disk Access covers the python child's chat.db reads
// (proven 2026-10-28: bash>python>node is denied, bash>node>python>node is allowed). Node itself does nothing else.
import { spawnSync } from "node:child_process";
const H = process.env.HOME;
const r = spawnSync(
  "/opt/homebrew/bin/python3",
  [`${H}/business-ops/money-inbox/money_inbox.py`, process.argv[2] || "run"],
  {
    stdio: "inherit",
    env: {
      ...process.env,
      PATH: "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin",
    },
  },
);
process.exit(r.status ?? 1);
