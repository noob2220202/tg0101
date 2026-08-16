/**
 * Loads `.env` before anything else in the worker process.
 *
 * Next.js reads `.env` on its own, but the worker is a plain Node process:
 * under a process manager (pm2, systemd, Docker) there is no shell to export
 * anything, so without this the worker starts with `SESSION_SECRET`,
 * `GATEWAY_TOKEN` and `TELEGRAM_API_*` unset.
 *
 * It worked before only because Prisma loads `.env` as a side effect of being
 * constructed, which happened to run first — a load-order accident, not a
 * guarantee. This module is imported first by `main.ts` so the guarantee is
 * explicit.
 *
 * A missing file is fine: the platform may be supplying the variables itself.
 */
try {
  process.loadEnvFile();
} catch {
  // No .env — assume the environment is already populated.
}

export {};
