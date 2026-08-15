import type { Metadata } from "next";
import "./globals.css";
import { NavBar } from "@/components/NavBar";

export const metadata: Metadata = {
  title: "텔레그램 자동 입장",
  description: "텔레그램 홍보방 자동 입장·수집 관리",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body className="min-h-screen">
        <NavBar />
        <main className="mx-auto w-full max-w-[1180px] px-6 py-6">{children}</main>
      </body>
    </html>
  );
}
