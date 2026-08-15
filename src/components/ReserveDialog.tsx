"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { CheckboxField, ErrorNote, Modal } from "./Modal";
import { apiRequest } from "@/lib/client/api";
import { DEFAULT_JOB_OPTIONS, estimateMinimumSeconds, JobOptions } from "@/lib/jobOptions";
import { humanDuration } from "@/lib/format";

export type ReserveAccount = {
  id: string;
  label: string;
  joinIntervalSec: number;
  pendingCount: number;
};

/**
 * "입장 예약" — turns the current selection into a queued batch.
 */
export function ReserveDialog({
  open,
  onClose,
  targetIds,
  accounts,
}: {
  open: boolean;
  onClose: () => void;
  targetIds: string[];
  accounts: ReserveAccount[];
}) {
  const router = useRouter();
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? "");
  const [name, setName] = useState("");
  const [options, setOptions] = useState<JobOptions>(DEFAULT_JOB_OPTIONS);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const account = accounts.find((a) => a.id === accountId) ?? accounts[0];
  const interval = account?.joinIntervalSec ?? 20;

  const estimate = useMemo(
    () => humanDuration(estimateMinimumSeconds(targetIds.length, interval)),
    [targetIds.length, interval],
  );

  const defaultName = `${targetIds.length}개 방 입장`;

  async function submit() {
    if (!accountId) {
      setError("사용할 계정을 선택하세요.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const result = await apiRequest<{ jobId: string; queued: number; skipped: number }>("/api/jobs", {
        body: { accountId, targetIds, name: name.trim() || defaultName, options },
      });
      onClose();
      router.push(`/jobs/${result.jobId}`);
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="입장 예약"
      description={`${targetIds.length}개 그룹에 대한 입장을 큐에 등록합니다.`}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose} disabled={submitting}>
            취소
          </button>
          <button type="button" className="btn btn-primary" onClick={submit} disabled={submitting || targetIds.length === 0}>
            {submitting ? "등록 중…" : "큐에 등록"}
          </button>
        </>
      }
    >
      <div className="space-y-5">
        <div>
          <label className="mb-1.5 block text-[13px] font-medium">사용할 텔레그램 계정</label>
          <select className="input" value={accountId} onChange={(event) => setAccountId(event.target.value)}>
            {accounts.length === 0 ? <option value="">등록된 계정이 없습니다</option> : null}
            {accounts.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label} — 대기 {item.pendingCount}건
              </option>
            ))}
          </select>
          <p className="mt-1.5 text-[12px] text-ink-muted">사용할 수 있는 활성 계정만 표시됩니다.</p>
        </div>

        <div>
          <label className="mb-1.5 block text-[13px] font-medium">작업 이름 (선택)</label>
          <input
            className="input"
            value={name}
            placeholder={defaultName}
            onChange={(event) => setName(event.target.value)}
          />
        </div>

        <CheckboxField
          checked={options.skipJoined}
          onChange={(value) => setOptions({ ...options, skipJoined: value })}
          label="이미 입장한 선행 채널은 건너뛰기"
          description="이 계정의 입장 기록을 기준으로 중복 입장을 방지합니다."
        />

        <div className="space-y-4 border-t border-line pt-4">
          <h3 className="text-[13px] font-medium">자동 처리</h3>

          <CheckboxField
            checked={options.autoPrereq}
            onChange={(value) => setOptions({ ...options, autoPrereq: value })}
            label="선행 채널 자동 인식"
            description="입장 직후 “먼저 아래 채널에 가입하세요” 안내가 오면, 요구된 채널을 읽어 큐에 넣고 그 방들에 먼저 입장한 뒤 인증을 진행합니다. 인식한 선행 채널은 해당 대상에 저장되어 다음 작업부터는 처음부터 반영됩니다."
          />

          <CheckboxField
            checked={options.probeHidden}
            onChange={(value) => setOptions({ ...options, probeHidden: value })}
            label="말을 걸어 숨은 선행 채널 찾기"
            description={
              <>
                입장 직후엔 아무 안내가 없다가, <strong className="font-medium text-ink">채팅을 보내는 순간</strong> “○○ 채널 구독 후
                이용하세요” 안내와 함께 채팅이 막히는 방이 있습니다. 이런 방은 읽기만 해서는 알아낼 수 없어, 읽어서 아무 안내도 찾지 못한
                방에 한해 짧은 인사말을 한 번 보내 반응을 떠보고 <strong className="font-medium text-ink">보낸 메시지는 곧바로 삭제</strong>합니다.
                방마다 딱 한 번만 시도합니다.
              </>
            }
          />

          <CheckboxField
            checked={options.autoCollect}
            onChange={(value) => setOptions({ ...options, autoCollect: value })}
            label="홍보 링크 자동 수집"
            description={
              <>
                입장한 방이 소개하는 다른 홍보방의 초대 링크를 읽어 <strong className="font-medium text-ink">수집된 링크</strong> 화면에
                모읍니다. 방마다 몇 시간 간격으로 여러 번 훑으며, 자동 등록·자동 입장 여부는 그 화면의{" "}
                <strong className="font-medium text-ink">수집 정책</strong>에서 정합니다.
              </>
            }
          />

          <CheckboxField
            checked={options.autoArchive}
            onChange={(value) => setOptions({ ...options, autoArchive: value })}
            label="자동으로 보관처리(아카이브)"
            description="입장 직후 텔레그램의 “보관된 채팅” 폴더로 옮겨 목록을 깨끗하게 유지합니다."
          />

          <CheckboxField
            checked={options.autoMute}
            onChange={(value) => setOptions({ ...options, autoMute: value })}
            label="알림 받지 않음으로 설정"
            description="해당 방의 알림을 무기한 끕니다. 선행 채널에도 함께 적용됩니다."
          />
        </div>

        <p className="rounded-md border border-sky-200 bg-sky-50 px-3 py-2.5 text-[12px] leading-relaxed text-sky-900">
          현재 페이싱 설정(간격 {interval}초)을 기준으로 최소 <strong className="font-semibold">{estimate}</strong> 이상 소요됩니다.
          텔레그램이 대기시간을 요구하면 자동으로 더 길어지며, 대기가 끝나면 워커가 알아서 재개합니다.
        </p>

        <ErrorNote message={error} />
      </div>
    </Modal>
  );
}
