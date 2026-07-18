const ALLOWED_LOAD_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "postgres", "pgbouncer"]);
const DISPOSABLE_DATABASE_NAME = /(?:^|[_-])(test|staging)(?:$|[_-])/i;

/**
 * Mutating load fixtures must never be pointed at a remote or production
 * database. The confirmation phrase is intentional operator consent; these
 * URL checks are an independent technical boundary.
 */
export function assertDisposableLoadDatabase(databaseUrl: string | undefined): void {
  if (!databaseUrl) throw new Error("DATABASE_URL is required for a load-test seed");

  let parsed: URL;
  try {
    parsed = new URL(databaseUrl);
  } catch {
    throw new Error("DATABASE_URL must be a valid PostgreSQL URL for a disposable load-test database");
  }

  if (parsed.protocol !== "postgresql:" && parsed.protocol !== "postgres:") {
    throw new Error("Refusing load-test seed: DATABASE_URL must use PostgreSQL");
  }
  if (!ALLOWED_LOAD_HOSTS.has(parsed.hostname)) {
    throw new Error("Refusing load-test seed: DATABASE_URL host must be localhost, 127.0.0.1, postgres, or pgbouncer");
  }

  const databaseName = decodeURIComponent(parsed.pathname).replace(/^\//, "");
  if (!DISPOSABLE_DATABASE_NAME.test(databaseName)) {
    throw new Error("Refusing load-test seed: database name must contain test or staging");
  }
}
