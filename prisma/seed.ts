import { PrismaClient } from "@prisma/client";

import { DEFAULT_JOB_OPTIONS, serializeJobOptions } from "../src/lib/jobOptions";
import { hashPassword } from "../src/lib/auth/password";
import { defaultPolicyData } from "../src/lib/services/policy";

/**
 * Development seed.
 *
 * Creates one operator, two Telegram accounts, a batch of targets and a queued
 * job so the worker has something to chew on. Intended to be run with
 * MOCK_TELEGRAM=1 — the accounts have no real session.
 */

const prisma = new PrismaClient();

const SEED_EMAIL = process.env.SEED_EMAIL ?? "admin@example.com";
const SEED_PASSWORD = process.env.SEED_PASSWORD ?? "changeme123";

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

  const owner = await prisma.user.upsert({
    where: { email: SEED_EMAIL },
    create: {
      email: SEED_EMAIL,
      name: "관리자",
      role: "ADMIN",
      passwordHash: await hashPassword(SEED_PASSWORD),
      policy: { create: defaultPolicyData() },
    },
    update: {},
  });

  const main = await prisma.account.upsert({
    where: { ownerId_label: { ownerId: owner.id, label: "산타산타" } },
    create: { ownerId: owner.id, label: "산타산타", phone: "+821000000001", status: "ACTIVE", joinIntervalSec: 20 },
    update: { status: "ACTIVE" },
  });

  const secondary = await prisma.account.upsert({
    where: { ownerId_label: { ownerId: owner.id, label: "산타홍보용" } },
    create: { ownerId: owner.id, label: "산타홍보용", phone: "+821000000002", status: "ACTIVE", joinIntervalSec: 30 },
    update: { status: "ACTIVE" },
  });

  const targets = [];
  for (const key of SAMPLE_KEYS) {
    targets.push(
      await prisma.target.upsert({
        where: { ownerId_key: { ownerId: owner.id, key } },
        create: { ownerId: owner.id, key, source: "MANUAL" },
        update: {},
      }),
    );
  }

  const existingJob = await prisma.joinJob.findFirst({ where: { accountId: main.id } });
  if (!existingJob) {
    await prisma.joinJob.create({
      data: {
        name: `${targets.length}개 방 입장`,
        ownerId: owner.id,
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

  // A keyword rule so the chat stream has something to match on.
  const ruleExists = await prisma.keywordRule.findFirst({ where: { ownerId: owner.id } });
  if (!ruleExists) {
    await prisma.keywordRule.create({
      data: { ownerId: owner.id, name: "구인·총판 감시", terms: "구인, 구직, 총판, 본사" },
    });
  }

  console.log(`done — 로그인: ${SEED_EMAIL} / ${SEED_PASSWORD}`);
  console.log(`accounts: ${main.label}, ${secondary.label} · targets: ${targets.length}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
