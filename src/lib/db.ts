import { Prisma, PrismaClient } from "@prisma/client";
import { queryDuration } from "./metrics";

const createClient = () => new PrismaClient({
  datasourceUrl: databaseUrl(),
  log: [{ emit: "event" as const, level: "query" as const }],
});
type InstrumentedPrismaClient = ReturnType<typeof createClient>;
const globalForPrisma = globalThis as unknown as { prisma?: InstrumentedPrismaClient };

function databaseUrl(): string | undefined {
  const source = process.env.DATABASE_URL;
  if (!source) return undefined;
  const limit = process.env.DATABASE_CONNECTION_LIMIT;
  if (!limit) return source;
  const url = new URL(source);
  url.searchParams.set("connection_limit", limit);
  url.searchParams.set("pool_timeout", process.env.DATABASE_POOL_TIMEOUT ?? "10");
  if (process.env.DATABASE_PGBOUNCER === "true") url.searchParams.set("pgbouncer", "true");
  return url.toString();
}

const client = globalForPrisma.prisma ?? createClient();

if (!globalForPrisma.prisma) {
  client.$on("query", (event: Prisma.QueryEvent) => {
    const operation = event.query.trimStart().split(/\s+/, 1)[0]?.toUpperCase() || "UNKNOWN";
    queryDuration.observe({ model: "database", operation }, event.duration / 1000);
  });
}

export const prisma = client;

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
