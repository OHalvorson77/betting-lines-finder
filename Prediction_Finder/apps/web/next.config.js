/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ["@prediction-finder/shared"],
  experimental: {
    typedRoutes: true,
  },
};

export default nextConfig;
