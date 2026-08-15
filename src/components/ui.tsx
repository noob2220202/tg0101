import clsx from "clsx";
import Link from "next/link";

/** Small presentational primitives shared across the screens. */

export function Card({ className, children }: { className?: string; children: React.ReactNode }) {
  return <section className={clsx("card", className)}>{children}</section>;
}

export function CardHeader({
  title,
  subtitle,
  right,
  className,
}: {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  right?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={clsx("flex items-start justify-between gap-4 px-4 py-3.5", className)}>
      <div className="min-w-0">
        <h2 className="card-title">{title}</h2>
        {subtitle ? <p className="card-sub mt-1">{subtitle}</p> : null}
      </div>
      {right ? <div className="flex shrink-0 items-center gap-2">{right}</div> : null}
    </div>
  );
}

/** One cell of the four-across metric strip at the top of the dashboard. */
export function StatCell({
  label,
  value,
  hint,
  href,
  tone = "default",
}: {
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  href?: string;
  tone?: "default" | "wait" | "bad";
}) {
  return (
    <div className="flex-1 px-5 py-4">
      <p className="text-[12px] text-ink-muted">{label}</p>
      <p
        className={clsx(
          "tnum mt-1.5 text-[26px] leading-none font-semibold",
          tone === "wait" && "text-wait",
          tone === "bad" && "text-bad",
        )}
      >
        {value}
      </p>
      {href ? (
        <Link href={href} className="mt-2 inline-block text-[12px] text-ink-muted underline decoration-stone-300 underline-offset-2 hover:text-ink">
          {hint}
        </Link>
      ) : hint ? (
        <p className="mt-2 text-[12px] text-ink-faint">{hint}</p>
      ) : null}
    </div>
  );
}

export function Badge({
  children,
  tone = "neutral",
}: {
  children: React.ReactNode;
  tone?: "neutral" | "wait" | "ok" | "bad";
}) {
  return (
    <span
      className={clsx(
        "badge",
        tone === "neutral" && "badge-neutral",
        tone === "wait" && "badge-wait",
        tone === "ok" && "bg-green-50 text-ok",
        tone === "bad" && "bg-red-50 text-bad",
      )}
    >
      {children}
    </span>
  );
}

/** The coloured dot in the activity feed. */
export function LevelDot({ level }: { level: string }) {
  return (
    <span
      className={clsx(
        "mt-1.5 inline-block h-1.5 w-1.5 shrink-0 rounded-full",
        level === "ERROR" && "bg-red-500",
        level === "WARN" && "bg-amber-500",
        level === "INFO" && "bg-emerald-600",
      )}
    />
  );
}

/** 0-100 confidence meter next to a collected link. */
export function ScoreBar({ score }: { score: number }) {
  const filled = Math.round((Math.max(0, Math.min(100, score)) / 100) * 5);
  return (
    <div className="flex items-center gap-2">
      <div className="flex gap-0.5" aria-hidden>
        {Array.from({ length: 5 }).map((_, i) => (
          <span
            key={i}
            className={clsx(
              "h-1.5 w-3 rounded-[1px]",
              i < filled ? (score >= 70 ? "bg-emerald-600" : "bg-amber-700/70") : "bg-stone-200",
            )}
          />
        ))}
      </div>
      <span className="tnum text-[12px] text-ink">{score}</span>
    </div>
  );
}

export function EmptyState({ children }: { children: React.ReactNode }) {
  return <p className="px-4 py-10 text-center text-[12px] text-ink-faint">{children}</p>;
}

/** Progress like "2/78". */
export function Progress({ done, total }: { done: number; total: number }) {
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  return (
    <div className="flex items-center gap-2">
      <span className="tnum text-[12px]">
        {done}/{total}
      </span>
      <div className="h-1 w-14 overflow-hidden rounded-full bg-stone-200">
        <div className="h-full rounded-full bg-stone-700" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
