"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { CheckboxField, ErrorNote, Modal } from "./Modal";
import { apiRequest } from "@/lib/client/api";

export type PolicyForm = {
  enabled: boolean;
  autoRegister: boolean;
  minScore: number;
  dailyLimit: number;
  joinAccountId: string | null;
  chainCollect: boolean;
  collectGroups: boolean;
  collectChannels: boolean;
  collectBots: boolean;
  collectUsers: boolean;
  minMembers: number;
  requiredKeywords: string;
  excludedKeywords: string;
};

/** "홍보 링크 수집 정책" — how harvested links are filtered and promoted. */
export function PolicyDialog({
  open,
  onClose,
  policy,
  accounts,
}: {
  open: boolean;
  onClose: () => void;
  policy: PolicyForm;
  accounts: Array<{ id: string; label: string }>;
}) {
  const router = useRouter();
  const [form, setForm] = useState<PolicyForm>(policy);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  function set<K extends keyof PolicyForm>(key: K, value: PolicyForm[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      await apiRequest("/api/policy", { method: "PUT", body: form });
      onClose();
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="홍보 링크 수집 정책"
      description="입장한 방에서 다른 방의 링크를 어떻게 수집하고 처리할지 정합니다."
      footer={
        <>
          <button type="button" className="btn" onClick={onClose} disabled={saving}>
            취소
          </button>
          <button type="button" className="btn btn-primary" onClick={save} disabled={saving}>
            {saving ? "저장 중…" : "저장"}
          </button>
        </>
      }
    >
      <div className="space-y-5">
        <CheckboxField
          checked={form.enabled}
          onChange={(value) => set("enabled", value)}
          label="홍보 링크 자동 수집 사용"
          description="입장한 방의 최근 메시지와 고정 메시지를 읽어 다른 방의 초대 링크를 모읍니다. 끄면 예약 시 켜 두었던 방들도 더 이상 수집하지 않습니다."
        />

        <CheckboxField
          checked={form.autoRegister}
          onChange={(value) => set("autoRegister", value)}
          label="기준 점수 이상이면 그룹 링크로 자동 등록"
          description="끄면 수집만 하고, 등록 여부는 이 화면에서 직접 승인합니다."
        />

        <div className="grid grid-cols-2 gap-4">
          <Field
            label="자동 등록 기준 점수"
            hint="0–100. 높일수록 확실한 것만 등록됩니다."
            value={form.minScore}
            onChange={(value) => set("minScore", value)}
            disabled={!form.autoRegister}
          />
          <Field
            label="하루 자동 등록 한도"
            hint="폭주 방지용 상한입니다."
            value={form.dailyLimit}
            onChange={(value) => set("dailyLimit", value)}
            disabled={!form.autoRegister}
          />
        </div>

        <div>
          <label className="mb-1.5 block text-[13px] font-medium">자동 등록 후 입장까지 진행할 계정</label>
          <select
            className="input"
            value={form.joinAccountId ?? ""}
            onChange={(event) => set("joinAccountId", event.target.value || null)}
          >
            <option value="">등록만 하고 입장하지 않음</option>
            {accounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.label}
              </option>
            ))}
          </select>
          <p className="mt-1.5 text-[12px] text-ink-muted">
            선택하면 자동 등록된 방에 이 계정으로 입장까지 예약합니다. 비워 두면 등록만 합니다.
          </p>
        </div>

        <CheckboxField
          checked={form.chainCollect}
          onChange={(value) => set("chainCollect", value)}
          label="연쇄 수집 (자동 입장한 방에서 또 수집)"
          description="켜면 수집 → 입장 → 다시 수집이 계속 이어집니다. 하루 등록 한도만이 유일한 제동장치이니 한도를 충분히 낮게 잡은 뒤에만 사용하세요."
        />

        <div className="space-y-2.5 border-t border-line pt-4">
          <h3 className="text-[13px] font-medium">수집할 방 종류</h3>
          <CheckboxField checked={form.collectGroups} onChange={(v) => set("collectGroups", v)} label="그룹 (홍보방·소통방)" />
          <CheckboxField checked={form.collectChannels} onChange={(v) => set("collectChannels", v)} label="채널 (읽기 전용)" />
          <CheckboxField checked={form.collectBots} onChange={(v) => set("collectBots", v)} label="봇" />
          <CheckboxField checked={form.collectUsers} onChange={(v) => set("collectUsers", v)} label="개인 계정" />
          <p className="text-[12px] text-ink-muted">
            텔레그램에 직접 확인한 결과로 거릅니다. 그룹만 켜 두면 홍보방·소통방만 남습니다.
          </p>
        </div>

        <Field
          label="최소 인원"
          hint="이보다 작은 방은 자동 등록하지 않습니다. 0 이면 제한 없음."
          value={form.minMembers}
          onChange={(value) => set("minMembers", value)}
        />

        <div>
          <label className="mb-1.5 block text-[13px] font-medium">필수 키워드</label>
          <input
            className="input"
            value={form.requiredKeywords}
            onChange={(event) => set("requiredKeywords", event.target.value)}
            placeholder="자유홍보방, 광고, 구인구직"
          />
          <p className="mt-1.5 text-[12px] text-ink-muted">쉼표로 구분. 지정하면 해당 단어가 포함된 링크에 가점을 줍니다.</p>
        </div>

        <div>
          <label className="mb-1.5 block text-[13px] font-medium">제외 키워드</label>
          <input
            className="input"
            value={form.excludedKeywords}
            onChange={(event) => set("excludedKeywords", event.target.value)}
            placeholder="예: 도박, 성인"
          />
          <p className="mt-1.5 text-[12px] text-ink-muted">쉼표로 구분. 해당 단어가 보이면 아예 수집하지 않습니다.</p>
        </div>

        <ErrorNote message={error} />
      </div>
    </Modal>
  );
}

function Field({
  label,
  hint,
  value,
  onChange,
  disabled,
}: {
  label: string;
  hint?: string;
  value: number;
  onChange: (value: number) => void;
  disabled?: boolean;
}) {
  return (
    <div>
      <label className="mb-1.5 block text-[13px] font-medium">{label}</label>
      <input
        type="number"
        className="input tnum"
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(Number(event.target.value))}
      />
      {hint ? <p className="mt-1.5 text-[12px] text-ink-muted">{hint}</p> : null}
    </div>
  );
}
