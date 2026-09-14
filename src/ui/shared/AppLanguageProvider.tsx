import { useCallback, type ReactNode } from "react";
import { LanguageProvider } from "../../i18n/LanguageProvider.tsx";
import type { LanguagePreference } from "../../i18n/language.ts";
import {
  getAppPreferences,
  saveAppPreferences,
} from "../../storage/appPreferencesRepository.ts";
import { logError } from "../../platform/errorLog.ts";
import { useLiveQuery } from "./useLiveQuery.ts";

export interface AppLanguageProviderProps {
  children: ReactNode;
  /**
   * What the bootstrap path already read before the first render. Used
   * only until the live query below produces its own first value — which
   * is normally the same value, and on the slow or failing bootstrap path
   * is the correction.
   */
  initialPreference: LanguagePreference;
}

/**
 * Owns the language preference's persistence, so `LanguageProvider` itself
 * stays free of storage and remains a pure, directly-testable component.
 *
 * Backlog item 113. The live query is what makes the bounded bootstrap
 * honest: if the pre-render read timed out or failed, this one lands
 * later and corrects the interface, with the stored row remaining the
 * single source of truth throughout. It also keeps a second tab in step
 * for free.
 */
export function AppLanguageProvider({
  children,
  initialPreference,
}: AppLanguageProviderProps) {
  const preferencesQuery = useCallback(() => getAppPreferences(), []);
  const preferences = useLiveQuery(preferencesQuery);

  const handleSelectPreference = useCallback((next: LanguagePreference) => {
    void saveAppPreferences({ language: next }).catch((error: unknown) => {
      logError("app-preferences-save", error);
    });
  }, []);

  return (
    <LanguageProvider
      preference={preferences?.language ?? initialPreference}
      onSelectPreference={handleSelectPreference}
    >
      {children}
    </LanguageProvider>
  );
}
