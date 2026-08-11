// Public readiness endpoint. Checks the required first-party database and the
// additive migration marker without exposing credentials, data, or vendor
// availability. Optional integrations remain operator-health concerns.

const REQUIRED_MIGRATION = "20260811222000";

function environment(name: string): string | undefined {
  const value = process.env[name];
  return value && value.trim() ? value.trim() : undefined;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export default async function handler(req: any, res: any) {
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.setHeader("Allow", "GET, HEAD");
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  res.setHeader("Cache-Control", "no-store");
  const baseUrl = environment("SUPABASE_URL") ?? environment("VITE_SUPABASE_URL");
  const anonKey = environment("SUPABASE_ANON_KEY") ?? environment("VITE_SUPABASE_PUBLISHABLE_KEY");
  const version = environment("VERCEL_GIT_COMMIT_SHA")?.slice(0, 12) ?? environment("APEX_BUILD_VERSION") ?? "local";
  const deployEnvironment = environment("VERCEL_ENV") ?? environment("NODE_ENV") ?? "local";

  const finish = (status: number, body: Record<string, unknown>) => {
    if (req.method === "HEAD") return res.status(status).end();
    return res.status(status).json(body);
  };

  if (!baseUrl || !anonKey) {
    return finish(503, {
      ok: false,
      service: "apex-web",
      status: "not_ready",
      database: "not_configured",
      migration: "unknown",
      version,
      environment: deployEnvironment,
      checkedAt: new Date().toISOString(),
    });
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 2_500);
  try {
    const response = await fetch(
      `${baseUrl.replace(/\/$/, "")}/rest/v1/apex_schema_meta?select=version&version=eq.${REQUIRED_MIGRATION}&limit=1`,
      {
        headers: { apikey: anonKey, authorization: `Bearer ${anonKey}` },
        signal: controller.signal,
      },
    );
    const rows = response.ok ? await response.json() as Array<{ version?: string }> : [];
    const migrationReady = rows.some((row) => row.version === REQUIRED_MIGRATION);
    const ready = response.ok && migrationReady;
    return finish(ready ? 200 : 503, {
      ok: ready,
      service: "apex-web",
      status: ready ? "ready" : "not_ready",
      database: response.ok ? "reachable" : "unreachable",
      migration: migrationReady ? REQUIRED_MIGRATION : "pending",
      version,
      environment: deployEnvironment,
      checkedAt: new Date().toISOString(),
    });
  } catch (error) {
    return finish(503, {
      ok: false,
      service: "apex-web",
      status: "not_ready",
      database: error instanceof Error && error.name === "AbortError" ? "timeout" : "unreachable",
      migration: "unknown",
      version,
      environment: deployEnvironment,
      checkedAt: new Date().toISOString(),
    });
  } finally {
    clearTimeout(timeout);
  }
}
