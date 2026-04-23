import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    pool: "forks",
    setupFiles: ["./tests/setup.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
      reportsDirectory: "coverage",
      include: ["src/**/*.ts", "tests/**/*.ts"],
      exclude: [
        "src/index.ts",
        "src/types/**",
        "src/db/migrations/**",
        "**/*.d.ts",
      ],
    },
    exclude: [
      "node_modules/**",
      "dist/**",
      "coverage/**",
    ],
  },
});
