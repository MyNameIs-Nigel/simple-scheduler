import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Self-hosted in Docker: emit a minimal server bundle.
  output: "standalone",

  // better-sqlite3 ships a native .node binary. Turbopack must not try to
  // bundle it — leave it to be required from node_modules at runtime.
  serverExternalPackages: ["better-sqlite3"],
};

export default nextConfig;
