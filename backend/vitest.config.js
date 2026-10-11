import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Tests live outside backend/ so the project layout keeps frontend, backend, prompts,
    // tests and docs separated as the assignment's structure requires.
    include: ["../tests/**/*.test.js"],
    environment: "node",
    globals: false,
    testTimeout: 15000,
    // Each file gets a fresh module registry, so the in-memory store cannot leak
    // between suites.
    isolate: true,
  },
});
