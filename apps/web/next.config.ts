import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  transpilePackages: ['@orchestra/domain'],
};

export default nextConfig;
