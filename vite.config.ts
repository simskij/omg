import { defineConfig } from "vite";

export default defineConfig({
  build: {
    chunkSizeWarningLimit: 600,
    outDir: "dist/client",
    emptyOutDir: true,
  },
  server: {
    proxy: {
      "/api": "http://localhost:3000",
    },
  },
});
