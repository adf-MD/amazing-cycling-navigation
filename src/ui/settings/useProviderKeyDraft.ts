import { useState, type Dispatch, type SetStateAction } from "react";

/**
 * An unfinished OpenRouteService key edit: the typed-but-unsaved key, whether
 * the Replace form is open, and the last save's error.
 *
 * Backlog item 121. These three values are the part of Settings that must
 * survive a switch to Status and back, so SettingsSection owns one instance
 * and hands it to SettingsScreen, which does not outlive the switch. They are
 * held in React state only and are never persisted — the key-storage rules
 * forbid it — so leaving the Settings section for another tab, or reloading,
 * discards them exactly as before.
 *
 * Deliberately excluded: whether the typed key is revealed (it is masked
 * again on return) and an armed Delete-key confirmation (item 118: an open
 * confirmation is resolved, never silently set aside), both of which stay
 * local to SettingsScreen.
 */
export interface ProviderKeyDraft {
  draftKey: string;
  setDraftKey: Dispatch<SetStateAction<string>>;
  isEditing: boolean;
  setIsEditing: Dispatch<SetStateAction<boolean>>;
  saveError: string | null;
  setSaveError: Dispatch<SetStateAction<string | null>>;
}

export function useProviderKeyDraft(): ProviderKeyDraft {
  const [draftKey, setDraftKey] = useState("");
  const [isEditing, setIsEditing] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  return { draftKey, setDraftKey, isEditing, setIsEditing, saveError, setSaveError };
}
