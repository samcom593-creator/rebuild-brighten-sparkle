// Public liveness endpoint. Deliberately proves only that this deployment can
// execute code; dependency checks live at /readiness.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export default function handler(req: any, res: any) {
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.setHeader("Allow", "GET, HEAD");
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  res.setHeader("Cache-Control", "no-store");
  const body = {
    ok: true,
    service: "apex-web",
    status: "alive",
    version: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 12) ?? process.env.APEX_BUILD_VERSION ?? "local",
    environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? "local",
    checkedAt: new Date().toISOString(),
  };
  if (req.method === "HEAD") return res.status(200).end();
  return res.status(200).json(body);
}
