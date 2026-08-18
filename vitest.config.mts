// Vitest configuration — Financial Phase 14 (full automated testing).
// Unit/integration tests run in the Node environment against pure modules
// (no DOM needed). The `@` alias mirrors tsconfig paths so test imports use
// the same specifier style as the app code.
import { defineConfig } from "vitest/config"
import path from "node:path"

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
})
