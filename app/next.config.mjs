/** @type {import('next').NextConfig} */
const nextConfig = {
  // The app reads/writes files outside the app dir (the drafts folder, config.json,
  // the logo). All such access happens in Node-runtime route handlers / server
  // components — never the browser. No special config needed for that.
  reactStrictMode: true,

  // instrumentation.ts gets compiled for the Edge runtime too. Its node:* imports
  // are guarded behind `NEXT_RUNTIME === "nodejs"` and never execute on Edge, but
  // webpack still tries to bundle them there and throws UnhandledSchemeError for the
  // `node:` scheme. Externalize `node:*` on the Edge build so it leaves them alone.
  webpack(config, { nextRuntime }) {
    if (nextRuntime === "edge") {
      const externalizeNodeScheme = ({ request }, cb) =>
        request && request.startsWith("node:") ? cb(null, "commonjs " + request) : cb();
      config.externals = Array.isArray(config.externals)
        ? [externalizeNodeScheme, ...config.externals]
        : [externalizeNodeScheme, config.externals].filter(Boolean);
    }
    return config;
  },
};

export default nextConfig;
