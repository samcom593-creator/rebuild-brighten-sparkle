// Persistent event listener. Drafting never blocks approval dispatch.
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { spawn } from "node:child_process";
const base = `${process.env.HOME}/business-ops/money-inbox`;
const require = createRequire(`${base}/package.json`);
const { createClient } = require("@supabase/supabase-js");
const cred = (name) =>
  readFileSync(`${process.env.HOME}/.config/apex-creds/${name}`, "utf8").trim();
const sb = createClient(cred("supabase.url"), cred("supabase-service.key"), {
  auth: { persistSession: false, autoRefreshToken: false },
});
let running = false,
  again = false;
function dispatch() {
  if (running) {
    again = true;
    return;
  }
  running = true;
  const child = spawn(process.execPath, [`${base}/runner.mjs`, "send"], {
    stdio: "inherit",
  });
  child.on("error", (e) => console.error("sender spawn failed", e.message));
  child.on("close", () => {
    running = false;
    if (again) {
      again = false;
      dispatch();
    }
  });
}
sb.channel("money-inbox-mac")
  .on(
    "postgres_changes",
    { event: "UPDATE", schema: "public", table: "money_inbox_threads" },
    (payload) => {
      if (payload.new.status === "approved" && !payload.new.private) dispatch();
    },
  )
  .subscribe((status) => {
    console.log(new Date().toISOString(), "money sender", status);
    if (status === "SUBSCRIBED") dispatch(); // reconcile durable approvals after every reconnect
    if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") process.exit(1); // launchd restarts
  });
