import tailwindcss from "@tailwindcss/vite";
import vue from "@vitejs/plugin-vue";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [vue(), tailwindcss()],
  server: {
    port: 5173,
    // The Fastify API runs on :3000 in dev (npm run dev at the repo root starts both).
    proxy: { "/api": { target: `http://localhost:${process.env.API_PORT ?? 3000}`, changeOrigin: true } },
  },
});
