import { PrismaClient } from "@prisma/client";

import { DEFAULT_JOB_OPTIONS, serializeJobOptions } from "../src/lib/jobOptions";

/**
 * Development seed.
 *
 * Creates two accounts, a batch of targets and one queued job so the worker has
 * something to chew on. Intended to be run with MOCK_TELEGRAM=1 — the accounts
 * have no real session and cannot talk to Telegram.
 */

const prisma = new PrismaClient();

const SAMPLE_KEYS = [
  "freepromo_kr",
  "jobs_talk_room",
  "koreagm06",
  "eventroom22",
  "kakaoroom",
  "bbbokk11",
  "darkweb2025",
  "bananagroup12",
  "tochelingside",
  "tunnel112",
  "viphongbo",
  "mbc828282",
  "wjdjanfk",
  "ck041",
  "cebu789",
  "sky22035010",
  "xypay8889",
  "wxcgroup",
  "yaflix11",
  "bitkoreaotc",
];

async function main() {
  console.log("seeding…");

  const policy = await prisma.collectionPolicy.upsert({
    where: { id: "default" },
    create: {
      id: "default",
      requiredKeywords: "자유홍보방, 광고, 구인구직, 총판, 토토, 본사",
      minScore: 70,
      dailyLimit: 100,
    },
    update: {},
  });

  const main = await prisma.account.upsert({
    where: { label: "산타산타" },
    create: { label: "산타산타", phone: "+821000000001", status: "ACTIVE", joinIntervalSec: 20 },
    update: { status: "ACTIVE" },
  });

  const secondary = await prisma.account.upsert({
    where: { label: "산타홍보용" },
    create: { label: "산타홍보용", phone: "+821000000002", status: "ACTIVE", joinIntervalSec: 30 },
    update: { status: "ACTIVE" },
  });

  const targets = [];
  for (const key of SAMPLE_KEYS) {
    targets.push(
      await prisma.target.upsert({
        where: { key },
        create: { key, source: "MANUAL" },
        update: {},
      }),
    );
  }

  // One batch for the primary account, so the worker starts with work to do.
  const existingJob = await prisma.joinJob.findFirst({ where: { accountId: main.id } });
  if (!existingJob) {
    await prisma.joinJob.create({
      data: {
        name: `${targets.length}개 방 입장`,
        accountId: main.id,
        status: "RUNNING",
        options: serializeJobOptions({ ...DEFAULT_JOB_OPTIONS, autoCollect: true }),
        totalCount: targets.length,
        tasks: {
          create: targets.map((target) => ({
            accountId: main.id,
            targetId: target.id,
            status: "PENDING",
          })),
        },
      },
    });
  }

  console.log(
    `done — accounts: ${main.label}, ${secondary.label} · targets: ${targets.length} · policy minScore ${policy.minScore}`,
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
