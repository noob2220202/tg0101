import Link from "next/link";
import { notFound } from "next/navigation";

import { ProfileEditor } from "@/components/ProfileEditor";
import { prisma } from "@/lib/db";
import { getOwner } from "@/lib/owner";
import { gatewayHealthy } from "@/lib/gateway/client";

export const dynamic = "force-dynamic";

export default async function AccountDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const owner = await getOwner();
  const { id } = await params;

  const account = await prisma.account.findFirst({
    where: { id, ownerId: owner.id },
    include: { health: true },
  });
  if (!account) notFound();

  const gatewayUp = await gatewayHealthy();

  return (
    <div className="space-y-4">
      <header>
        <Link href="/accounts" className="text-[12px] text-ink-muted hover:text-ink">
          ← 계정 목록
        </Link>
        <h1 className="mt-1 text-[17px] font-semibold">{account.label}</h1>
        <p className="mt-1 text-[12px] text-ink-muted">
          텔레그램 계정의 프로필과 보안 설정을 여기서 바꿉니다. 변경은 실제 계정에 즉시 반영됩니다.
        </p>
      </header>

      <ProfileEditor
        accountId={account.id}
        accountLabel={account.label}
        gatewayUp={gatewayUp}
        health={
          account.health
            ? {
                riskScore: account.health.riskScore,
                riskReason: account.health.riskReason,
                spamStatus: account.health.spamStatus,
                checkedAt: account.health.checkedAt?.toISOString() ?? null,
              }
            : null
        }
      />
    </div>
  );
}
