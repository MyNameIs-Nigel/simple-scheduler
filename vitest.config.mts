import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname),
      // `server-only` throws unless it is resolved under React's `react-server`
      // condition, which vitest does not set. The package is a build-time
      // marker with no runtime behaviour, so pointing it at its own empty
      // module lets the server modules that import it be tested directly.
      "server-only": path.resolve(import.meta.dirname, "node_modules/server-only/empty.js"),
    },
  },
  test: {
    environment: "node",
    include: ["**/__tests__/**/*.test.ts"],
  },
});
