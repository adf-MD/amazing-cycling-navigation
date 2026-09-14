import { useTranslate } from "../../i18n/useTranslate.ts";

export interface NoApiKeyNoticeProps {
  onOpenSettings: () => void;
}

/**
 * The exact, required notice shown wherever road routing is blocked by a
 * missing key — Planning otherwise keeps working fully without one (see
 * CLAUDE.md: waypoint editing and drafts must never depend on a key).
 */
export function NoApiKeyNotice({ onOpenSettings }: NoApiKeyNoticeProps) {
  const { t } = useTranslate();
  return (
    <div role="status" className="status-row status-row--info row planning-section">
      <p>{t("planning.noKey.message")}</p>
      <button type="button" className="btn-secondary" onClick={onOpenSettings}>
        {t("planning.noKey.openSettings")}
      </button>
    </div>
  );
}
