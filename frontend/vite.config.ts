import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  root: path.resolve(__dirname),
  server: {
    host: "::",
    port: 8080,
    hmr: {
      overlay: false,
    },
  },
  plugins: [react(), mode === "development" && componentTagger()].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    rollupOptions: {
      output: {
        // Firebase and React in their own files: they change less often than the app, so phones keep them
        // cached between deploys. Every page needs both. The rest is split by the lazy page imports in App.tsx
        // (recharts goes with Reports) and by Reports loading reportExport (exceljs, jspdf, html2canvas)
        // only when an export button is clicked. Do not add a manual chunk for a library only some pages use:
        // Rollup moves shared helper packages into it and the login page then has to download it.
        manualChunks(id) {
          if (!id.includes("node_modules")) return undefined;
          if (/[\\/]node_modules[\\/](@firebase|firebase)[\\/]/.test(id)) return "firebase";
          if (/[\\/]node_modules[\\/](react|react-dom|react-router|react-router-dom|scheduler)[\\/]/.test(id)) return "react";
          return undefined;
        },
      },
    },
  },
}));
