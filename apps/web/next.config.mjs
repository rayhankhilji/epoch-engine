import path from 'node:path';

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // This repo is a workspace nested inside a larger tree; pin the trace root so
  // Next does not walk up and adopt an unrelated lockfile.
  outputFileTracingRoot: path.join(import.meta.dirname, '../..'),
  // The UI talks to the Epoch server purely over its REST + SSE API, so this
  // proxy is the only wiring between them. Nothing here imports the engine.
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: `${process.env.EPOCH_API_URL ?? 'http://localhost:8787'}/api/:path*`,
      },
    ];
  },
};

export default nextConfig;
