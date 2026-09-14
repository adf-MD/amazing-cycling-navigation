import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import { AppLanguageProvider } from "./ui/shared/AppLanguageProvider.tsx";
import { resolveInitialLanguagePreference } from "./i18n/bootstrap.ts";
import {
  DOCUMENT_LANGUAGE_TAGS,
  readNavigatorLanguages,
  resolveLanguage,
} from "./i18n/language.ts";
import { getAppPreferences } from "./storage/appPreferencesRepository.ts";
import "./index.css";

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("Root element not found");
}

// Backlog item 113. The stored language preference is read BEFORE the
// first render, not after it. Reading it afterwards would paint English
// and then swap — a visible flash, and a moment of wrong
// `document.documentElement.lang` for assistive technology. This is one
// indexed get on a singleton row, on a screen that is blank until React
// mounts anyway; see bootstrap.ts for the measurements behind its bound
// and for what happens when the read is slow or fails.
const { preference } = await resolveInitialLanguagePreference(getAppPreferences);
document.documentElement.lang =
  DOCUMENT_LANGUAGE_TAGS[resolveLanguage(preference, readNavigatorLanguages())];

createRoot(rootElement).render(
  <StrictMode>
    <AppLanguageProvider initialPreference={preference}>
      <App />
    </AppLanguageProvider>
  </StrictMode>,
);
