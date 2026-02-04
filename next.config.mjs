/** @type {import('next').NextConfig} */
const nextConfig = {
  // 启用 standalone 输出模式（仅用于 Docker 部署，非 Docker 部署请注释掉）
  // output: 'standalone',

  // 转译 Ant Design 以支持服务端渲染
  transpilePackages: ['antd', '@ant-design/icons', '@ant-design/nextjs-registry'],

  // 生产构建优化（针对小内存服务器 <= 2GB）
  experimental: {
    // 禁用 webpack worker，使用单进程编译
    webpackBuildWorker: false,
    // 启用 instrumentation hook
    instrumentationHook: true,
  },

  // Webpack 配置优化 - 极限低内存模式
  webpack: (config, { isServer }) => {
    // 禁用 source map
    config.devtool = false;
    
    // 禁用持久化缓存
    config.cache = false;
    
    // 单线程压缩（关键！TerserPlugin 默认多线程很吃内存）
    if (config.optimization && config.optimization.minimizer) {
      config.optimization.minimizer.forEach((minimizer) => {
        if (minimizer.constructor.name === 'TerserPlugin') {
          minimizer.options.parallel = false;
        }
      });
    }
    
    return config;
  },

  // 安全响应头配置
  async headers() {
    return [
      {
        // 对所有路由应用安全响应头
        source: '/:path*',
        headers: [
          {
            key: 'X-DNS-Prefetch-Control',
            value: 'on',
          },
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=31536000; includeSubDomains',
          },
          {
            key: 'X-Content-Type-Options',
            value: 'nosniff',
          },
          {
            key: 'X-Frame-Options',
            value: 'DENY',
          },
          {
            key: 'X-XSS-Protection',
            value: '1; mode=block',
          },
          {
            key: 'Referrer-Policy',
            value: 'strict-origin-when-cross-origin',
          },
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=(), browsing-topics=()',
          },
        ],
      },
      {
        // API 路由额外配置
        source: '/api/:path*',
        headers: [
          {
            key: 'Cache-Control',
            value: 'no-store, no-cache, must-revalidate, proxy-revalidate',
          },
          {
            key: 'Pragma',
            value: 'no-cache',
          },
          {
            key: 'Expires',
            value: '0',
          },
        ],
      },
    ];
  },
};

export default nextConfig;

