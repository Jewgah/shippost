/** @type {import('next').NextConfig} */
const nextConfig = {
  // The app reads/writes files outside the app dir (the drafts folder, config.json,
  // the logo). All such access happens in Node-runtime route handlers / server
  // components — never the browser. No special config needed for that.
  reactStrictMode: true,
};

export default nextConfig;
