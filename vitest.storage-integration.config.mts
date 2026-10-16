import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/integration/driver-registration-storage.test.ts"],
    fileParallelism: false,
    // These assertions cross Auth, PostgREST and Storage HTTP services; cold
    // local containers can exceed Vitest's five-second unit-test default.
    testTimeout: 30_000,
  },
})
