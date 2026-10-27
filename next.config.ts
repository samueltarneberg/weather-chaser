import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // cities.json is read from disk at runtime, so make sure it ships with the search route
  outputFileTracingIncludes: {
    "/api/search": ["./src/data/cities.json"],
  },
};

export default nextConfig;
