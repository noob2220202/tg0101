/**
 * pm2 process definitions.
 *
 *   npm run build            # required — the web app runs the built output
 *   pm2 start ecosystem.config.cjs
 *   pm2 logs                 # both processes
 *   pm2 save && pm2 startup  # survive a reboot
 *
 * Both processes read `.env` themselves (Next natively, the worker via
 * src/worker/loadEnv.ts), so pm2 does not need to inject anything — keeping
 * secrets out of this file, which is committed.
 */

const WEB_PORT = process.env.WEB_PORT || 4001;

module.exports = {
  apps: [
    {
      name: "tg-web",
      // Invoking Next's binary directly rather than through npm keeps pm2's
      // signals going to the actual server instead of an npm wrapper.
      script: "node_modules/next/dist/bin/next",
      args: `start -p ${WEB_PORT}`,
      cwd: __dirname,

      // Fork, not cluster: several Next instances would each write to the same
      // SQLite file and fight over the lock.
      exec_mode: "fork",
      instances: 1,

      autorestart: true,
      max_memory_restart: "600M",
      env: { NODE_ENV: "production" },

      out_file: "logs/web.out.log",
      error_file: "logs/web.err.log",
      time: true,
    },
    {
      name: "tg-worker",
      script: "node_modules/tsx/dist/cli.mjs",
      args: "src/worker/main.ts",
      cwd: __dirname,

      // MUST stay at one instance. The worker owns every MTProto session, and
      // two copies would split each account's update stream and corrupt read
      // state. It also hosts the gateway, so a second copy could not bind the
      // port anyway.
      exec_mode: "fork",
      instances: 1,

      autorestart: true,
      max_memory_restart: "800M",
      // Telegram sessions take a moment to close cleanly on SIGTERM.
      kill_timeout: 10000,
      env: { NODE_ENV: "production" },

      out_file: "logs/worker.out.log",
      error_file: "logs/worker.err.log",
      time: true,
    },
  ],
};
