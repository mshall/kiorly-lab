import path from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const API = process.env.LAB_API_ORIGIN ?? "http://127.0.0.1:3200";

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { "@": path.resolve(__dirname, "./src") } },
  server: { host: "127.0.0.1", port: Number(process.env.LAB_WEB_PORT ?? 5191), strictPort: true, proxy: { "/api": { target: API, changeOrigin: true } } },
  preview: { host: "127.0.0.1", port: Number(process.env.LAB_WEB_PORT ?? 5191), strictPort: true, proxy: { "/api": { target: API, changeOrigin: true } } },
});
