import { defineConfig } from "vite";

// CI 会把 VITE_BASE_URL 设为 CDN 前缀(例如 https://cos-sh.tiye.me/<owner>/<repo>/),
// 这样 dist 里的静态资源会从 CDN 加载;本地开发时回落到 "/"。
const base = process.env.VITE_BASE_URL || "/";

export default defineConfig({
  base,
  build: {
    target: "es2022",
    sourcemap: true,
    chunkSizeWarningLimit: 2000,
  },
  server: {
    port: 5173,
  },
});
