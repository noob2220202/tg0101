import { redirect } from "next/navigation";

import { LoginForm } from "@/components/LoginForm";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  if (await getCurrentUser()) redirect("/");

  // With no operators yet, the form doubles as first-run setup.
  const isFirstRun = (await prisma.user.count()) === 0;

  return (
    <div className="mx-auto flex min-h-[70vh] w-full max-w-[400px] flex-col justify-center">
      <div className="mb-6">
        <h1 className="text-[18px] font-semibold">{isFirstRun ? "관리자 계정 만들기" : "로그인"}</h1>
        <p className="mt-1.5 text-[12px] text-ink-muted">
          {isFirstRun
            ? "첫 실행입니다. 콘솔에 접속할 관리자 계정을 만드세요."
            : "텔레그램 자동 입장 콘솔에 로그인합니다."}
        </p>
      </div>
      <LoginForm firstRun={isFirstRun} />
    </div>
  );
}
