/** @type {import('next').NextConfig} */
const API = process.env.API_URL || "http://127.0.0.1:8000";

// The FastAPI backend stays the single source of truth. In dev (and behind a
// single reverse proxy in prod) every /api call is forwarded there, so the
// browser talks same-origin and the Bearer token flows through untouched.
const nextConfig = {
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${API}/api/:path*` }];
  },
};

export default nextConfig;
