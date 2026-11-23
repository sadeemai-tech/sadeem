import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // The repo root also has package-lock.json; tell Next which lockfile owns this app.
  outputFileTracingRoot: path.resolve(here, '..'),
};

export default nextConfig;
