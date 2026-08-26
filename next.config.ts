import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Self-hosted in Docker: emit a minimal server bundle.
  output: "standalone",

  // Both of these must be required from node_modules at runtime rather than
  // bundled: better-sqlite3 ships a native .node binary, and
  // @touch4it/ical-timezones reads tzdata files from its own package
  // directory. Bundling the latter makes its VTIMEZONE generator silently
  // return nothing, which produces feeds with TZID references and no
  // matching VTIMEZONE block.
  serverExternalPackages: ["better-sqlite3", "@touch4it/ical-timezones"],
};

export default nextConfig;
