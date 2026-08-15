"use client";

import { useEffect, useRef } from "react";
import clsx from "clsx";

import { MessageRow } from "./types";

/** Bubble list, pinned to the bottom the way a chat client should be. */
export function MessageList({
  messages,
  accountId,
  loading,
  hasMore,
  onLoadMore,
}: {
  messages: MessageRow[];
  accountId: string;
  loading: boolean;
  hasMore: boolean;
  onLoadMore: () => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const lastIdRef = useRef<number | null>(null);

  // Only auto-scroll when a genuinely new message arrives, so loading older
  // history does not yank the view away from what the operator is reading.
  useEffect(() => {
    const newest = messages[messages.length - 1];
    if (!newest) return;
    if (lastIdRef.current !== null && newest.id <= lastIdRef.current) return;
    lastIdRef.current = newest.id;

    // Scroll the pane itself. `scrollIntoView` on a sentinel would also scroll
    // every scrollable ancestor, dragging the whole page down with it.
    const container = containerRef.current;
    if (container) container.scrollTo({ top: container.scrollHeight, behavior: "smooth" });
  }, [messages]);

  return (
    <div ref={containerRef} className="flex-1 overflow-y-auto overscroll-contain px-4 py-4">
      {hasMore ? (
        <div className="mb-4 text-center">
          <button type="button" className="btn" onClick={onLoadMore} disabled={loading}>
            {loading ? "불러오는 중…" : "이전 메시지 더 보기"}
          </button>
        </div>
      ) : null}

      {messages.length === 0 && !loading ? (
        <p className="py-12 text-center text-[12px] text-ink-faint">메시지가 없습니다.</p>
      ) : null}

      <div className="space-y-2">
        {messages.map((message) => (
          <Bubble key={`${message.peerId}-${message.id}`} message={message} accountId={accountId} />
        ))}
      </div>
    </div>
  );
}

function Bubble({ message, accountId }: { message: MessageRow; accountId: string }) {
  const time = new Date(message.date).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" });

  return (
    <div className={clsx("flex", message.outgoing ? "justify-end" : "justify-start")}>
      <div className={clsx("max-w-[76%] min-w-0", message.outgoing && "items-end")}>
        {!message.outgoing && message.senderName ? (
          <p className="mb-0.5 px-1 text-[11px] font-medium text-ink-muted">{message.senderName}</p>
        ) : null}

        <div
          className={clsx(
            "rounded-xl px-3 py-2 text-[13px] leading-relaxed break-words whitespace-pre-wrap",
            message.outgoing ? "bg-accent text-white" : "border border-line bg-white text-ink",
          )}
        >
          {message.mediaType ? (
            <Media message={message} accountId={accountId} />
          ) : null}
          {message.text ? <span>{message.text}</span> : null}
        </div>

        <p className={clsx("mt-0.5 px-1 text-[10px] text-ink-faint", message.outgoing && "text-right")}>{time}</p>
      </div>
    </div>
  );
}

function Media({ message, accountId }: { message: MessageRow; accountId: string }) {
  const src =
    `/api/chat/media?accountId=${encodeURIComponent(accountId)}` +
    `&peerId=${encodeURIComponent(message.peerId)}&messageId=${message.id}`;

  if (message.mediaType === "PHOTO") {
    return (
      // Media is fetched through our own proxy route, so no remote loader applies.
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={src}
        alt={message.mediaName ?? "사진"}
        loading="lazy"
        className="mb-1.5 max-h-[320px] w-full rounded-lg object-cover"
      />
    );
  }

  return (
    <a href={src} target="_blank" rel="noreferrer" className="mb-1 flex items-center gap-2 underline">
      <span>📎</span>
      <span className="truncate">{message.mediaName ?? mediaLabel(message.mediaType)}</span>
    </a>
  );
}

function mediaLabel(type: string | null): string {
  switch (type) {
    case "VIDEO":
      return "동영상";
    case "VOICE":
      return "음성 메시지";
    case "STICKER":
      return "스티커";
    case "DOCUMENT":
      return "파일";
    default:
      return "첨부";
  }
}
