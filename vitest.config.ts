import { defineConfig } from "vitest/config";
import { resolve } from "path";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    coverage: {
      provider: "v8",
      include: ["src/backend/**/*.ts"],
    },
    // jsdom-free: component tests use react-dom/server static rendering
    // against the node environment; no browser globals are required.
  },
  resolve: {
    alias: {
      "@": resolve(__dirname, "./src"),
    },
  },
});
