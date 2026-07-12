import { prisma } from "@/lib/db";

export function logEvent(level: "info" | "warn" | "error", event: string, metadata: Record<string, unknown> = {}, error?: unknown) {
  const payload = {
    timestamp: new Date().toISOString(),
    level,
    event,
    ...metadata,
    ...(error ? { error: error instanceof Error ? { name: error.name, message: error.message, stack: error.stack } : String(error) } : {}),
  };
  const line = JSON.stringify(payload);
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.info(line);
}

export async function recordCronResult(status: "ok" | "failed", details: Record<string, unknown>) {
  await prisma.systemState.upsert({
    where: { key: "cron:reconcile" },
    update: { valueJson: JSON.stringify({ status, ...details }) },
    create: { key: "cron:reconcile", valueJson: JSON.stringify({ status, ...details }) },
  });
}
