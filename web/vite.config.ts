import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

// The dev proxy follows the backend port: PORT from the shell or the root .env
// (the web workspace runs with cwd = web/, so ".." is the repo root). Default 3001.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, "..", "");
  const apiPort = Number.parseInt(env.PORT ?? "", 10) || 3001;

  return {
    plugins: [react()],
    server: {
      port: 5173,
      // 127.0.0.1 (not "localhost") to match the API's IPv4 loopback binding.
      proxy: { "/api": `http://127.0.0.1:${apiPort}` },
    },
  };
});
