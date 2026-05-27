/// <reference types="vitest" />
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react-swc";
import path from "path";

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: ["./src/tests/setup.ts"],
    include: ["src/tests/**/*.test.{ts,tsx}", "src/**/__tests__/**/*.{ts,tsx}"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      include: [
        "src/shared/**",
        "src/hooks/**",
        "src/lib/**",
        "src/components/ProtectedRoute.tsx",
        "src/components/ErrorBoundary.tsx",
        "src/components/SupabaseHealthBanner.tsx",
      ],
      exclude: [
        "src/lib/awardCanvasGenerator.ts",  // canvas API, test separately with canvas mock
        "src/lib/gameFx.tsx",               // animation/audio, jsdom limitation
        "src/lib/analyticsBoot.ts",         // side-effect boot, no testable exports
      ],
      thresholds: {
        lines: 60,
        functions: 60,
        branches: 50,
      },
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
