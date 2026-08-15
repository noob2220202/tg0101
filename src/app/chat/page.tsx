import Link from "next/link";

import { ChatClient } from "@/components/chat/ChatClient";
import { ChatAccount } from "@/components/chat/types";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth/session";
import { gatewayHealthy } from "@/lib/gateway/client";

export const dynamic = "force-dynamic";

export default async function ChatPage() {
  const user = await requireUser();

  const [accounts, gatewayUp] = await Promise.all([
    prisma.account.findMany({
      where: { ownerId: user.id, status: { not: "DISABLED" } },
      orderBy: { createdAt: "asc" },
      select: { id: true, label: true, status: true, firstName: true, lastName: true, username: true },
    }),
    gatewayHealthy(),
  ]);

  const rows: ChatAccount[] = accounts.map((account) => ({
    id: account.id,
    label: account.label,
    status: account.status,
    displayName: [account.firstName, account.lastName].filter(Boolean).join(" ") || account.label,
    username: account.username,
  }));

  return (
    // Viewport-height column: navbar (49px) plus the main element's vertical
    // padding (48px) is the only thing above it.
    <div className="flex h-[calc(100dvh-100px)] min-h-[560px] flex-col gap-4">
      <header className="flex shrink-0 flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[17px] font-semibold">채팅</h1>
          <p className="mt-1 text-[12px] text-ink-muted">
            연결된 계정의 대화를 웹에서 그대로 주고받습니다. 계정을 전환해도 알림은 계속 수신됩니다.
          </p>
        </div>
        <Link href="/keywords" className="btn">
          키워드 알림 설정
        </Link>
      </header>

      <ChatClient accounts={rows} gatewayUp={gatewayUp} initialAccountId={rows[0]?.id ?? null} />
    </div>
  );
}
