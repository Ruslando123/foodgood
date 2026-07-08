import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(__dirname, "src") },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // Интеграционные тесты делят одну SQLite-базу — гоняем последовательно
    fileParallelism: false,
    sequence: { concurrent: false },
  },
});
