import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    // Relative so it composes with the CLI's `--dir src` (patterns resolve
    // against --dir, not the project root).
    include: ["**/*.test.{ts,tsx}"],
    exclude: ["node_modules/**", "e2e/**"],
  },
});
