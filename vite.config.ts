import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    host: "0.0.0.0",
    port: 5173,
  },
  preview: {
    host: "0.0.0.0",
    port: 4173,
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    css: true,
    /**
     * The interface tests mount the whole editor against a real IndexedDB and drive it through
     * user events. Alone each is well under a second, but the suite runs files in parallel and
     * under that contention they cross the five-second default — a timing flake, not a
     * failure. Fifteen seconds is far above what any of them takes and still catches a test
     * that has genuinely hung.
     */
    testTimeout: 15_000,
  },
});
