"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import clsx from "clsx";

import { apiRequest } from "@/lib/client/api";

const LINKS = [
  { href: "/", label: "대시보드" },
  { href: "/chat", label: "채팅" },
  { href: "/keywords", label: "키워드" },
  { href: "/groups", label: "그룹 목록" },
  { href: "/queue", label: "큐" },
  { href: "/collected", label: "수집된 링크" },
  { href: "/accounts", label: "계정" },
];

export function NavBar({ user }: { user: { name: string; email: string } | null }) {
  const pathname = usePathname();
  const router = useRouter();

  // The login screen is its own world.
  if (!user) return null;

  async function signOut() {
    await apiRequest("/api/auth/login", { method: "DELETE" }).catch(() => {});
    router.replace("/login");
    router.refresh();
  }

  return (
    <header className="sticky top-0 z-30 border-b border-line bg-card/90 backdrop-blur">
      <div className="mx-auto flex w-full max-w-[1180px] items-center gap-6 px-6 py-3">
        <Link href="/" className="text-[13px] font-semibold tracking-tight">
          텔레그램 자동 입장
        </Link>

        <nav className="flex items-center gap-1">
          {LINKS.map((link) => {
            const active = link.href === "/" ? pathname === "/" : pathname.startsWith(link.href);
            return (
              <Link
                key={link.href}
                href={link.href}
                className={clsx(
                  "rounded-md px-2.5 py-1.5 text-[12px] transition-colors",
                  active ? "bg-stone-100 font-medium text-ink" : "text-ink-muted hover:bg-stone-50",
                )}
              >
                {link.label}
              </Link>
            );
          })}
        </nav>

        <div className="ml-auto flex items-center gap-3">
          <span className="text-[12px] text-ink-muted" title={user.email}>
            {user.name}
          </span>
          <button type="button" onClick={signOut} className="btn-ghost rounded-md px-2 py-1 text-[12px]">
            로그아웃
          </button>
        </div>
      </div>
    </header>
  );
}
