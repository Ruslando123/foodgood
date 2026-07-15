import { readFileSync } from "node:fs";

const files = [
  ".env.example",
  "render.yaml",
  "playwright.config.ts",
  ".github/workflows/ci.yml",
  "docs/LAUNCH_CHECKLIST.md",
  "docs/PRODUCTION_RUNBOOK.md",
  "docs/PILOT_RUNBOOK.md",
];
const forbidden = /ALLOW_MOCK_PAYMENTS_IN_PRODUCTION\s*[:=]\s*["']?true\b/;
const violations = files.filter((file) => forbidden.test(readFileSync(file, "utf8")));
if (violations.length) throw new Error(`Forbidden production mock-payment flag in: ${violations.join(", ")}`);
console.log("Production configuration guard passed");
