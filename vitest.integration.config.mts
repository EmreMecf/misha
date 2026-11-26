import { defineConfig } from "vitest/config";
import { loadEnv } from "vite";
import path from "node:path";

// Entegrasyon testleri: gerçek PostgreSQL (npm run db:up && npm run db:deploy). Sıralı çalışır.
export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  test: {
    include: ["src/**/*.integration.test.ts"],
    env: loadEnv("test", process.cwd(), ""),
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
