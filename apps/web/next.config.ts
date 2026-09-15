import type { NextConfig } from "next";
import { join } from "node:path";

const nextConfig: NextConfig = {
  output: "standalone",
  outputFileTracingRoot: join(import.meta.dirname, "../.."),
  reactCompiler: true,
  transpilePackages: [
    "@caption-generator/captions",
    "@caption-generator/types",
  ],
};

export default nextConfig;
