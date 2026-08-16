/**
 * pm2 process definitions.
 *
 *   npm run deploy           # build + (re)start both processes — use this
 *
 * or by hand:
 *   npm run build            # required — the web app runs the built output
 *   pm2 start ecosystem.config.cjs
 *   pm2 logs                 # both processes
 *   pm2 save && pm2 startup  # survive a reboot
 *
 * Both processes read `.env` themselves (Next natively, the worker via
 * src/worker/loadEnv.ts), so pm2 does not need to inject anything — keeping
 * secrets out of this file, which is committed.
 *
 * WEB_HOST / WEB_PORT are read from the shell here, not from .env, because pm2
 * evaluates this file before either process starts.
 */

const fs = require("node:fs");
const path = require("node:path");

// `next start` runs the built output, so a missing build makes tg-web exit
// immediately — and with plain autorestart that becomes an infinite loop that
// only fills the log. Say so once, here, where it is readable.
if (!fs.existsSync(path.join(__dirname, ".next", "BUILD_ID"))) {
  console.warn(
    "\n[tg] .next 빌드가 없습니다. `npm run build` 를 먼저 실행하세요.\n" +
      "    빌드 없이 시작하면 tg-web 은 몇 번 재시도한 뒤 errored 로 멈춥니다.\n",
  );
}

const WEB_PORT = process.env.WEB_PORT || 4001;
// There is no sign-in, so the default binding is loopback only. Override with
// WEB_HOST=0.0.0.0 once the port is firewalled.
const WEB_HOST = process.env.WEB_HOST || "127.0.0.1";

module.exports = {
  apps: [
    {
      name: "tg-web",
      // Invoking Next's binary directly rather than through npm keeps pm2's
      // signals going to the actual server instead of an npm wrapper.
      script: "node_modules/next/dist/bin/next",
      args: `start -H ${WEB_HOST} -p ${WEB_PORT}`,
      cwd: __dirname,

      // Fork, not cluster: several Next instances would each write to the same
      // SQLite file and fight over the lock.
      exec_mode: "fork",
      instances: 1,

      autorestart: true,
      max_memory_restart: "600M",
      // Give up instead of looping forever: anything that dies within 20s of
      // starting is broken, not unlucky. pm2 parks it as `errored` after this
      // many tries so the failure is visible in `pm2 list`.
      min_uptime: "20s",
      max_restarts: 5,
      restart_delay: 4000,
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
      min_uptime: "20s",
      max_restarts: 5,
      restart_delay: 4000,
      env: { NODE_ENV: "production" },

      out_file: "logs/worker.out.log",
      error_file: "logs/worker.err.log",
      time: true,
    },
  ],
};
