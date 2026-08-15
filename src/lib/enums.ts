/**
 * SQLite has no enums, so status columns are strings. These are the allowed
 * values plus their Korean labels for the UI.
 */

export const AccountStatus = {
  ACTIVE: "ACTIVE",
  COOLDOWN: "COOLDOWN",
  NEEDS_CHECK: "NEEDS_CHECK",
  DISABLED: "DISABLED",
} as const;
export type AccountStatus = (typeof AccountStatus)[keyof typeof AccountStatus];

export const ACCOUNT_STATUS_LABEL: Record<AccountStatus, string> = {
  ACTIVE: "활성",
  COOLDOWN: "대기 중",
  NEEDS_CHECK: "점검 필요",
  DISABLED: "사용 안 함",
};

export const TaskStatus = {
  PENDING: "PENDING",
  RUNNING: "RUNNING",
  WAITING_APPROVAL: "WAITING_APPROVAL",
  SUCCESS: "SUCCESS",
  FAILED: "FAILED",
  SKIPPED: "SKIPPED",
} as const;
export type TaskStatus = (typeof TaskStatus)[keyof typeof TaskStatus];

export const TASK_STATUS_LABEL: Record<TaskStatus, string> = {
  PENDING: "대기",
  RUNNING: "진행 중",
  WAITING_APPROVAL: "승인 대기",
  SUCCESS: "완료",
  FAILED: "실패",
  SKIPPED: "건너뜀",
};

/** Statuses that still occupy the queue. */
export const OPEN_TASK_STATUSES: TaskStatus[] = ["PENDING", "RUNNING"];

export const JobStatus = {
  RUNNING: "RUNNING",
  PAUSED: "PAUSED",
  DONE: "DONE",
  CANCELLED: "CANCELLED",
} as const;
export type JobStatus = (typeof JobStatus)[keyof typeof JobStatus];

export const JOB_STATUS_LABEL: Record<JobStatus, string> = {
  RUNNING: "진행 중",
  PAUSED: "일시중지",
  DONE: "완료",
  CANCELLED: "취소됨",
};

export const LinkStatus = {
  PENDING: "PENDING",
  APPROVED: "APPROVED",
  REGISTERED: "REGISTERED",
  EXCLUDED: "EXCLUDED",
} as const;
export type LinkStatus = (typeof LinkStatus)[keyof typeof LinkStatus];

export const LINK_STATUS_LABEL: Record<LinkStatus, string> = {
  PENDING: "검토 대기",
  APPROVED: "승인됨",
  REGISTERED: "등록됨",
  EXCLUDED: "제외됨",
};

export const EntityType = {
  GROUP: "GROUP",
  CHANNEL: "CHANNEL",
  BOT: "BOT",
  USER: "USER",
  UNKNOWN: "UNKNOWN",
} as const;
export type EntityType = (typeof EntityType)[keyof typeof EntityType];

export const ENTITY_TYPE_LABEL: Record<EntityType, string> = {
  GROUP: "그룹",
  CHANNEL: "채널",
  BOT: "봇",
  USER: "개인",
  UNKNOWN: "미확인",
};

export const TargetKind = {
  PUBLIC: "PUBLIC",
  PRIVATE: "PRIVATE",
} as const;
export type TargetKind = (typeof TargetKind)[keyof typeof TargetKind];

export const TargetSource = {
  MANUAL: "MANUAL",
  AUTO_COLLECT: "AUTO_COLLECT",
} as const;
export type TargetSource = (typeof TargetSource)[keyof typeof TargetSource];

export const LogLevel = {
  INFO: "INFO",
  WARN: "WARN",
  ERROR: "ERROR",
} as const;
export type LogLevel = (typeof LogLevel)[keyof typeof LogLevel];
