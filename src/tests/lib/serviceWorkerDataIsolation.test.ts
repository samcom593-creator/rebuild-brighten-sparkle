import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";

const ROOT = resolve(__dirname, "../../..");

function runtimeRoutes() {
  const source = ts.createSourceFile("vite.config.ts", readFileSync(resolve(ROOT, "vite.config.ts"), "utf8"), ts.ScriptTarget.Latest, true);
  let initializer: ts.Expression | undefined;
  const visit = (node: ts.Node) => {
    if (ts.isPropertyAssignment(node) && node.name.getText(source) === "runtimeCaching") initializer = node.initializer;
    ts.forEachChild(node, visit);
  };
  visit(source);
  if (!initializer) throw new Error("No runtime cache configuration found");
  const compiled = ts.transpileModule(`(${initializer.getText(source)})`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } });
  return runInNewContext(compiled.outputText) as Array<{ urlPattern: (input: { request: Request; url: URL; sameOrigin: boolean }) => boolean; handler: string }>;
}

describe("service worker account and media isolation", () => {
  it("never intercepts authenticated API or storage range requests with a URL-keyed cache", () => {
    const routes = runtimeRoutes();
    const base = "https://xrzweoneiieddzxogewk.supabase.co";
    for (const path of ["/rest/v1/deals?select=*", "/auth/v1/user", "/functions/v1/lead-recording-url", "/storage/v1/object/public/training-videos/lesson.mp4", "/storage/v1/object/sign/recordings/private.mp4?token=synthetic"]) {
      const url = new URL(path, base);
      const request = new Request(url, { headers: { Authorization: "Bearer synthetic-account-a", Range: "bytes=0-1023" } });
      expect(routes.some((route) => route.urlPattern({ request, url, sameOrigin: false })), path).toBe(false);
    }
    // This is a synthetic same-origin chunk, not a published production asset.
    const asset = new URL("https://app.example.test/assets/route-synthetic.js");
    expect(routes.find((route) => route.urlPattern({ request: new Request(asset), url: asset, sameOrigin: true }))?.handler).toBe("CacheFirst");
  });

  it("removes the old private-response cache on worker activation without clearing static assets", async () => {
    const listeners = new Map<string, (event: { waitUntil: (work: Promise<unknown>) => void }) => void>();
    const remove = vi.fn().mockResolvedValue(true);
    runInNewContext(readFileSync(resolve(ROOT, "public/sw-push.js"), "utf8"), {
      self: { addEventListener: (name: string, listener: (event: { waitUntil: (work: Promise<unknown>) => void }) => void) => listeners.set(name, listener) },
      caches: { delete: remove },
    });
    let work: Promise<unknown> | undefined;
    listeners.get("activate")!({ waitUntil: (pending) => { work = pending; } });
    await work;
    expect(remove).toHaveBeenCalledExactlyOnceWith("supabase-rest");
  });
});
