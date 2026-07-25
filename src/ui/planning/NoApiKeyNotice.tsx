export interface NoApiKeyNoticeProps {
  onOpenSettings: () => void;
}

/**
 * The exact, required notice shown wherever road routing is blocked by a
 * missing key — Planning otherwise keeps working fully without one (see
 * CLAUDE.md: waypoint editing and drafts must never depend on a key).
 */
export function NoApiKeyNotice({ onOpenSettings }: NoApiKeyNoticeProps) {
  return (
    <div role="status">
      <p>Road routing requires your personal OpenRouteService key.</p>
      <button type="button" onClick={onOpenSettings}>
        Open Settings
      </button>
    </div>
  );
}
