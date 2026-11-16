import swc from "unplugin-swc";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.spec.ts", "src/**/*.spec.ts"],
    globals: true,
    environment: "node",
    hookTimeout: 60000,
    testTimeout: 30000,
    globalSetup: "./test/global-setup.ts",
    setupFiles: ["./test/setup-env.ts"],
    // E2E suites share one database; run files sequentially.
    fileParallelism: false,
  },
  plugins: [
    swc.vite({
      module: { type: "es6" },
      jsc: {
        parser: { syntax: "typescript", decorators: true },
        transform: { decoratorMetadata: true, legacyDecorator: true },
        target: "es2022",
      },
    }),
  ],
});
