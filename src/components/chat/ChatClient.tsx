"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import clsx from "clsx";

import { MessageList } from "./MessageList";
import { ChatAccount, DialogRow, MessageRow, StreamEvent } from "./types";
import { Badge } from "../ui";
import { ErrorNote } from "../Modal";
import { apiRequest } from "@/lib/client/api";
import { relativeTime } from "@/lib/format";

/**
 * The web Telegram client: accounts on the left, that account's conversations
 * next to them, the open conversation on the right.
 *
 * The message stream is a single server-sent-event connection covering every
 * account the operator owns, so switching accounts costs nothing and unread
 * counts stay live for conversations that are not open.
 */
export function ChatClient({
  accounts,
  gatewayUp,
  initialAccountId,
}: {
  accounts: ChatAccount[];
  gatewayUp: boolean;
  initialAccountId: string | null;
}) {
  const [accountId, setAccountId] = useState(initialAccountId ?? accounts[0]?.id ?? "");
  const [dialogs, setDialogs] = useState<DialogRow[]>([]);
  const [peerId, setPeerId] = useState<string | null>(null);
  const [messages, setMessages] = useState<MessageRow[]>([]);
  const [draft, setDraft] = useState("");
  const [search, setSearch] = useState("");

  const [loadingDialogs, setLoadingDialogs] = useState(false);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [sending, setSending] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [alerts, setAlerts] = useState<Array<{ id: string; text: string }>>([]);

  // Read inside the SSE handler, which is registered once and must not close
  // over stale state.
  const openPeerRef = useRef<string | null>(null);
  const accountRef = useRef(accountId);
  useEffect(() => {
    openPeerRef.current = peerId;
  }, [peerId]);
  useEffect(() => {
    accountRef.current = accountId;
  }, [accountId]);

  const activeDialog = dialogs.find((d) => d.peerId === peerId) ?? null;

  // ---- loading ------------------------------------------------------------

  const loadDialogs = useCallback(async (id: string) => {
    if (!id) return;
    setLoadingDialogs(true);
    setError(null);
    try {
      const rows = await apiRequest<DialogRow[]>("/api/chat", {
        body: { action: "dialogs", accountId: id, limit: 100, archived: false },
      });
      setDialogs(rows);
    } catch (err) {
      setError((err as Error).message);
      setDialogs([]);
    } finally {
      setLoadingDialogs(false);
    }
  }, []);

  const loadHistory = useCallback(
    async (id: string, peer: string, before?: number) => {
      setLoadingMessages(true);
      setError(null);
      try {
        const rows = await apiRequest<MessageRow[]>("/api/chat", {
          body: { action: "history", accountId: id, peerId: peer, limit: 50, offsetId: before },
        });
        setHasMore(rows.length >= 50);
        setMessages((current) => (before ? [...rows, ...current] : rows));
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setLoadingMessages(false);
      }
    },
    [],
  );

  useEffect(() => {
    setPeerId(null);
    setMessages([]);
    void loadDialogs(accountId);
  }, [accountId, loadDialogs]);

  // ---- live stream --------------------------------------------------------

  useEffect(() => {
    if (!gatewayUp) return;

    const source = new EventSource("/api/chat/stream");

    source.onmessage = (event) => {
      let payload: StreamEvent;
      try {
        payload = JSON.parse(event.data);
      } catch {
        return;
      }
      if (payload.type !== "message" || !payload.message || !payload.accountId) return;

      const message = payload.message;
      const isCurrentAccount = payload.accountId === accountRef.current;
      const isOpenChat = isCurrentAccount && message.peerId === openPeerRef.current;

      if (isOpenChat) {
        setMessages((current) =>
          current.some((m) => m.id === message.id) ? current : [...current, message],
        );
      }

      if (isCurrentAccount) {
        setDialogs((current) =>
          current.map((dialog) =>
            dialog.peerId === message.peerId
              ? {
                  ...dialog,
                  lastMessageText: message.text,
                  lastMessageAt: message.date,
                  lastMessageOut: message.outgoing,
                  // An open conversation is being read as it arrives.
                  unreadCount: isOpenChat || message.outgoing ? 0 : dialog.unreadCount + 1,
                }
              : dialog,
          ),
        );
      }

      if (payload.keywordHits?.length) {
        const label = `${payload.keywordHits.join(", ")} — ${message.text.slice(0, 60)}`;
        setAlerts((current) => [{ id: `${message.peerId}-${message.id}`, text: label }, ...current].slice(0, 2));
      }
    };

    return () => source.close();
  }, [gatewayUp]);

  // ---- actions ------------------------------------------------------------

  async function openDialog(dialog: DialogRow) {
    setPeerId(dialog.peerId);
    setMessages([]);
    setHasMore(true);
    await loadHistory(accountId, dialog.peerId);

    if (dialog.unreadCount > 0) {
      setDialogs((current) =>
        current.map((d) => (d.peerId === dialog.peerId ? { ...d, unreadCount: 0 } : d)),
      );
      await apiRequest("/api/chat", {
        body: { action: "read", accountId, peerId: dialog.peerId },
      }).catch(() => {});
    }
  }

  async function send() {
    const text = draft.trim();
    if (!text || !peerId) return;

    setSending(true);
    setError(null);
    try {
      const message = await apiRequest<MessageRow>("/api/chat", {
        body: { action: "send", accountId, peerId, text },
      });
      setMessages((current) => [...current, message]);
      setDraft("");
      setDialogs((current) =>
        current.map((d) =>
          d.peerId === peerId
            ? { ...d, lastMessageText: text, lastMessageAt: message.date, lastMessageOut: true }
            : d,
        ),
      );
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSending(false);
    }
  }

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return dialogs;
    return dialogs.filter(
      (d) => d.title.toLowerCase().includes(term) || (d.username ?? "").toLowerCase().includes(term),
    );
  }, [dialogs, search]);

  const totalUnread = dialogs.reduce((sum, d) => sum + d.unreadCount, 0);

  if (accounts.length === 0) {
    return (
      <div className="card p-10 text-center">
        <p className="text-[13px] font-medium">연결된 계정이 없습니다.</p>
        <p className="mt-1.5 text-[12px] text-ink-muted">계정을 먼저 연결하면 이 화면에서 채팅할 수 있습니다.</p>
      </div>
    );
  }

  return (
    // Fills whatever height the page hands down, so a keyword alert appearing
    // above shrinks the panes instead of pushing the composer off-screen.
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      {!gatewayUp ? (
        <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-wait">
          워커가 실행 중이 아닙니다. 채팅은 워커 프로세스가 세션을 들고 있어야 동작합니다 —{" "}
          <code className="font-mono">npm run worker</code> 를 실행하세요.
        </p>
      ) : null}

      {alerts.length > 0 ? (
        <div className="space-y-1.5">
          {alerts.map((alert) => (
            <p
              key={alert.id}
              className="flex items-start gap-2 rounded-md border border-sky-200 bg-sky-50 px-3 py-2 text-[12px] text-sky-900"
            >
              <span className="shrink-0 font-medium">키워드</span>
              <span className="min-w-0 truncate">{alert.text}</span>
            </p>
          ))}
        </div>
      ) : null}

      <ErrorNote message={error} />

      <div className="card grid min-h-0 flex-1 grid-cols-[190px_300px_1fr] overflow-hidden">
        {/* ---- accounts --------------------------------------------------- */}
        <aside className="flex min-h-0 flex-col border-r border-line">
          <div className="border-b border-line px-3 py-2.5">
            <p className="text-[11px] font-medium text-ink-muted">계정</p>
          </div>
          <div className="flex-1 overflow-y-auto">
            {accounts.map((account) => (
              <button
                key={account.id}
                type="button"
                onClick={() => setAccountId(account.id)}
                className={clsx(
                  "flex w-full flex-col items-start gap-0.5 border-b border-line px-3 py-2.5 text-left transition-colors",
                  account.id === accountId ? "bg-stone-100" : "hover:bg-stone-50",
                )}
              >
                <span className="truncate text-[12px] font-medium">{account.label}</span>
                <span className="truncate text-[11px] text-ink-muted">
                  {account.username ? `@${account.username}` : account.displayName}
                </span>
              </button>
            ))}
          </div>
          {totalUnread > 0 ? (
            <div className="border-t border-line px-3 py-2 text-[11px] text-ink-muted">
              안 읽음 <span className="tnum font-medium text-ink">{totalUnread}</span>
            </div>
          ) : null}
        </aside>

        {/* ---- dialogs ---------------------------------------------------- */}
        <aside className="flex min-h-0 flex-col border-r border-line">
          <div className="border-b border-line px-3 py-2">
            <input
              className="input py-1.5 text-[12px]"
              placeholder="대화 검색"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>
          <div className="flex-1 overflow-y-auto">
            {loadingDialogs ? (
              <p className="px-3 py-6 text-center text-[12px] text-ink-faint">불러오는 중…</p>
            ) : filtered.length === 0 ? (
              <p className="px-3 py-6 text-center text-[12px] text-ink-faint">대화가 없습니다.</p>
            ) : (
              filtered.map((dialog) => (
                <button
                  key={dialog.peerId}
                  type="button"
                  onClick={() => openDialog(dialog)}
                  className={clsx(
                    "flex w-full flex-col gap-0.5 border-b border-line px-3 py-2.5 text-left transition-colors",
                    dialog.peerId === peerId ? "bg-stone-100" : "hover:bg-stone-50",
                  )}
                >
                  <span className="flex w-full items-center gap-1.5">
                    <span className="min-w-0 flex-1 truncate text-[12px] font-medium">{dialog.title}</span>
                    {dialog.muted ? <span className="text-[10px] text-ink-faint">🔕</span> : null}
                    <span className="shrink-0 text-[10px] text-ink-faint">
                      {relativeTime(dialog.lastMessageAt)}
                    </span>
                  </span>
                  <span className="flex w-full items-center gap-1.5">
                    <span className="min-w-0 flex-1 truncate text-[11px] text-ink-muted">
                      {dialog.lastMessageOut ? "나: " : ""}
                      {dialog.lastMessageText || "…"}
                    </span>
                    {dialog.unreadCount > 0 ? (
                      <span className="tnum shrink-0 rounded-full bg-accent px-1.5 py-0.5 text-[10px] font-medium text-white">
                        {dialog.unreadCount}
                      </span>
                    ) : null}
                  </span>
                </button>
              ))
            )}
          </div>
        </aside>

        {/* ---- conversation ------------------------------------------------ */}
        <section className="flex min-h-0 min-w-0 flex-col">
          {activeDialog ? (
            <>
              <header className="flex items-center gap-2 border-b border-line px-4 py-2.5">
                <div className="min-w-0">
                  <p className="truncate text-[13px] font-medium">{activeDialog.title}</p>
                  <p className="truncate text-[11px] text-ink-muted">
                    {activeDialog.username ? `@${activeDialog.username}` : activeDialog.peerId}
                  </p>
                </div>
                <div className="ml-auto flex items-center gap-1.5">
                  {activeDialog.muted ? <Badge>알림 꺼짐</Badge> : null}
                  <Badge>{activeDialog.peerType === "USER" ? "개인" : activeDialog.peerType === "CHANNEL" ? "채널" : "그룹"}</Badge>
                </div>
              </header>

              <MessageList
                messages={messages}
                accountId={accountId}
                loading={loadingMessages}
                hasMore={hasMore && messages.length > 0}
                onLoadMore={() => {
                  const oldest = messages[0];
                  if (oldest) void loadHistory(accountId, activeDialog.peerId, oldest.id);
                }}
              />

              <footer className="border-t border-line p-3">
                <div className="flex items-end gap-2">
                  <textarea
                    className="input max-h-32 min-h-[38px] flex-1 resize-none py-2"
                    rows={1}
                    placeholder="메시지를 입력하세요 (Enter 전송, Shift+Enter 줄바꿈)"
                    value={draft}
                    onChange={(event) => setDraft(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" && !event.shiftKey) {
                        event.preventDefault();
                        void send();
                      }
                    }}
                  />
                  <button
                    type="button"
                    className="btn btn-primary h-[38px] px-4"
                    onClick={send}
                    disabled={sending || !draft.trim()}
                  >
                    {sending ? "전송 중…" : "전송"}
                  </button>
                </div>
              </footer>
            </>
          ) : (
            <div className="flex flex-1 items-center justify-center">
              <p className="text-[12px] text-ink-faint">왼쪽에서 대화를 선택하세요.</p>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
