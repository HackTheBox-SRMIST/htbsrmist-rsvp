/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    // Keep the MongoDB driver out of the server bundle: it resolves optional
    // native/dynamic requires that webpack cannot trace.
    serverComponentsExternalPackages: ['mongodb'],
  },
};

export default nextConfig;
