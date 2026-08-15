import { prisma } from "../lib/db";
import { getChatSession } from "../lib/telegram";
import { scoreHealth } from "../lib/health";
import { writeLog } from "../lib/services/logs";

/**
 * Periodic account-health assessment.
 *
 * The risk score is recomputed for every account on each pass; the @SpamBot
 * conversation is far more expensive (it sends a real message) so it runs at
 * most once every six hours per account.
 */

const SPAM_CHECK_INTERVAL_MS = 6 * 3600_000;
/** Accounts probed against @SpamBot per pass. */
const SPAM_CHECKS_PER_PASS = 2;

export async function runHealthChecks(now = new Date()): Promise<number> {
  const accounts = await prisma.account.findMany({
    where: { status: { not: "DISABLED" } },
    include: { health: true },
  });

  const since = new Date(now.getTime() - 24 * 3600_000);
  let spamChecksDone = 0;

  for (const account of accounts) {
    const [joins24h, failures24h, floodWaits24h] = await Promise.all([
      prisma.joinTask.count({
        where: { accountId: account.id, status: "SUCCESS", finishedAt: { gte: since } },
      }),
      prisma.joinTask.count({
        where: { accountId: account.id, status: "FAILED", finishedAt: { gte: since } },
      }),
      prisma.joinLog.count({
        where: { accountId: account.id, level: "WARN", createdAt: { gte: since }, message: { contains: "대기를 요구" } },
      }),
    ]);

    let spamStatus = account.health?.spamStatus ?? "UNKNOWN";
    const lastCheck = account.health?.checkedAt?.getTime() ?? 0;
    const isStale = now.getTime() - lastCheck > SPAM_CHECK_INTERVAL_MS;

    // Only live accounts can be asked, and only a couple per pass.
    if (isStale && spamChecksDone < SPAM_CHECKS_PER_PASS && account.status === "ACTIVE" && account.sessionString) {
      try {
        const session = await getChatSession(account.id);
        const result = await session.checkSpamStatus();
        spamStatus = result.status;
        spamChecksDone += 1;

        await prisma.accountHealth.upsert({
          where: { accountId: account.id },
          create: {
            accountId: account.id,
            spamStatus: result.status,
            spamMessage: result.message,
            restrictedUntil: result.restrictedUntil,
            checkedAt: now,
          },
          update: {
            spamStatus: result.status,
            spamMessage: result.message,
            restrictedUntil: result.restrictedUntil,
            checkedAt: now,
          },
        });

        if (result.status === "LIMITED") {
          await writeLog({
            accountId: account.id,
            level: "ERROR",
            message: `스팸 제한이 감지되었습니다. ${result.message.slice(0, 120)}`,
          });
          // A limited account must stop joining, or the limit gets worse.
          await prisma.account.update({
            where: { id: account.id },
            data: { status: "NEEDS_CHECK", cooldownReason: "스팸 제한이 적용되었습니다." },
          });
        }
      } catch {
        // A failed probe just leaves the previous status in place.
      }
    }

    const ageDays = (now.getTime() - account.createdAt.getTime()) / 86_400_000;
    const { score, reason } = scoreHealth({
      joinIntervalSec: account.joinIntervalSec,
      joins24h,
      failures24h,
      floodWaits24h,
      spamStatus,
      accountAgeDays: ageDays,
    });

    await prisma.accountHealth.upsert({
      where: { accountId: account.id },
      create: { accountId: account.id, spamStatus, riskScore: score, riskReason: reason },
      update: { riskScore: score, riskReason: reason },
    });
  }

  return accounts.length;
}
