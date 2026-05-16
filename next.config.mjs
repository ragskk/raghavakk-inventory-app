/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: 'raw.githubusercontent.com' },
      { protocol: 'https', hostname: 'raghavakkstudio.com' }
    ]
  },
  // sql.js WASM must be bundled into serverless functions. The .wasm import is
  // dynamic (locateFile resolves at runtime) so file-trace can miss it.
  // schema.sql is read at module init via fs.readFileSync — also needs tracing.
  outputFileTracingIncludes: {
    '/**/*': [
      './node_modules/sql.js/dist/sql-wasm.wasm',
      './schema.sql'
    ]
  },
  // sql.js is UMD with its own runtime loader; letting Next webpack bundle it
  // strips module.exports and produces "Cannot set properties of undefined" at
  // runtime. Mark external so Node resolution stays intact.
  serverExternalPackages: ['sql.js']
};

export default nextConfig;
