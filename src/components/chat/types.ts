/** Wire shapes shared by the chat components. Dates arrive as ISO strings. */

export type ChatAccount = {
  id: string;
  label: string;
  status: string;
  displayName: string;
  username: string | null;
};

export type DialogRow = {
  peerId: string;
  peerType: string;
  title: string;
  username: string | null;
  unreadCount: number;
  lastMessageId: number | null;
  lastMessageText: string;
  lastMessageAt: string | null;
  lastMessageOut: boolean;
  pinned: boolean;
  muted: boolean;
  archived: boolean;
};

export type MessageRow = {
  id: number;
  peerId: string;
  text: string;
  date: string;
  outgoing: boolean;
  senderId: string | null;
  senderName: string | null;
  mediaType: string | null;
  mediaName: string | null;
};

/** What the SSE endpoint pushes. */
export type StreamEvent = {
  type: string;
  accountId?: string;
  message?: MessageRow;
  keywordHits?: string[];
};
