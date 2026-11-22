import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";

/**
 * 三种构建产物：
 * - 默认（开发 / 桌面预览）：走 /api 代理，代码分割正常；
 * - VITE_DIRECT=1：直连学校网关，仍是模块化产物；
 * - VITE_APK=1：直连 + 单个 IIFE 文件。APK 的页面从 file:///android_asset 起，
 *   Chromium 对 file:// 下的 ES module 一律按 CORS 拒绝，所以必须打成普通脚本。
 */
const APK = process.env.VITE_APK === "1";
// APK 从 file:// 起、没有后端进程，必须直连学校网关：把标记补进 env，供 src/api.ts 判定
if (APK) process.env.VITE_DIRECT = "1";

// 版本号由构建时注入，避免「我的」页写的版本和 APK 的 versionName 各维护一份
const APP_VERSION = process.env.APP_VERSION || "dev";

export default defineConfig({
  // 相对路径：APK 里页面从 file:///android_asset/www/index.html 起，绝对路径会失效
  base: "./",
  define: {
    __APP_VERSION__: JSON.stringify(APP_VERSION),
  },
  plugins: [vue()],
  server: {
    host: "127.0.0.1",
    port: 5180,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:18900",
        changeOrigin: true,
      },
    },
  },
  build: {
    target: "es2020",
    outDir: APK ? "dist-apk" : "dist",
    assetsInlineLimit: 8192,
    modulePreload: APK ? false : undefined,
    cssCodeSplit: !APK,
    rollupOptions: APK
      ? {
          output: {
            format: "iife",
            inlineDynamicImports: true,
            entryFileNames: "app.js",
            chunkFileNames: "app.js",
            assetFileNames: "app.[ext]",
          },
        }
      : undefined,
  },
});
