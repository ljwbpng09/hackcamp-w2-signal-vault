import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // snapshot.json is served from public/ as a static file — no special config needed.
  // Add rewrites/headers here if the worker writes to a different location in production.
}

export default nextConfig
