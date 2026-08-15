import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // GramJS ships Node-only code (crypto, net, zlib). Keep it out of the bundler
  // so the auth routes can require it at runtime instead.
  serverExternalPackages: ["teleproto", "@prisma/client"],
};

export default nextConfig;
