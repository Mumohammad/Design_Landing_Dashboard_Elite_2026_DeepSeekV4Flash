import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/integration/driver-registration-storage.test.ts"],
    fileParallelism: false,
  },
})
