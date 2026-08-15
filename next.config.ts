import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // GramJS ships Node-only code (crypto, net, zlib). Keep it out of the bundler
  // so the auth routes can require it at runtime instead.
  serverExternalPackages: ["teleproto", "@prisma/client"],
  // Next writes AGENTS.md / CLAUDE.md into the repo root otherwise, which is
  // just untracked noise here.
  agentRules: false,
};

export default nextConfig;
