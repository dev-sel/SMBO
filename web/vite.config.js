import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: { port: 5173 },
  optimizeDeps: {
    // maplibre-gl ships its own worker. Pre-bundled by Vite it loads its style silently
    // forever: no load event, no error, an empty map. Served as source it works.
    exclude: ["maplibre-gl"],
  },
});
