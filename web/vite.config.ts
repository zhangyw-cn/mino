import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  base: "/",
  root: path.resolve(__dirname),
  build: {
    manifest: true,
    outDir: path.resolve(__dirname, "../internal/ui/dist"),
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: path.resolve(__dirname, "index.html"),
        viewer: path.resolve(__dirname, "md/viewer.html"),
      },
    },
  },
  server: {
    proxy: {
      "/api": "http://127.0.0.1:52341",
      "/apps": "http://127.0.0.1:52341",
    },
  },
});
