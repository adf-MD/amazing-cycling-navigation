import { useCallback, useState, type SubmitEvent } from "react";
import { systemClock, useNow, type Clock } from "../../platform/clock.ts";
import { useOnlineStatus } from "../../platform/onlineStatus.ts";
import { logError } from "../../platform/errorLog.ts";
import {
  deleteProviderKey,
  getProviderKey,
  getProviderKeyVerification,
  InvalidApiKeyError,
  saveProviderKey,
} from "../../storage/providerKeyRepository.ts";
import {
  getPlanningPreferences,
  savePlanningPreferences,
} from "../../storage/planningPreferencesRepository.ts";
import { useLiveQuery } from "../shared/useLiveQuery.ts";
import { ConfirmDialog } from "../shared/ConfirmDialog.tsx";
import { describeProviderKeyStatus } from "./providerKeyStatus.ts";

export interface SettingsScreenProps {
  clock?: Clock;
}

export function SettingsScreen({ clock = systemClock }: SettingsScreenProps) {
  const keyQuery = useCallback(() => getProviderKey(), []);
  const key = useLiveQuery(keyQuery);
  const verificationQuery = useCallback(() => getProviderKeyVerification(), []);
  const verification = useLiveQuery(verificationQuery);
  const preferencesQuery = useCallback(() => getPlanningPreferences(), []);
  const preferences = useLiveQuery(preferencesQuery);

  const now = useNow(clock);
  const online = useOnlineStatus();

  const [draftKey, setDraftKey] = useState("");
  const [keyVisible, setKeyVisible] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [pendingDelete, setPendingDelete] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // avoidFerriesByDefault is undefined both while the live query is still
  // loading and when no preferences row has ever been saved — resolved to
  // the app's own documented default (true) either way, matching
  // fromStoredPlanningPreferences's own no-row default.
  const avoidFerriesByDefault = preferences?.avoidFerriesByDefault ?? true;
  const [isSavingPreferences, setIsSavingPreferences] = useState(false);
  const [preferencesError, setPreferencesError] = useState<string | null>(null);

  const handleSave = (event: SubmitEvent) => {
    event.preventDefault();
    const trimmed = draftKey.trim();
    if (!trimmed) return;
    saveProviderKey(trimmed)
      .then(() => {
        setDraftKey("");
        setKeyVisible(false);
        setIsEditing(false);
        setSaveError(null);
      })
      .catch((error: unknown) => {
        logError("settings-save-key", error);
        setSaveError(
          error instanceof InvalidApiKeyError
            ? "This key contains a character that cannot be sent in a request header. Check for an accidental line break introduced while copying it."
            : "The key could not be saved on this device. Try again.",
        );
      });
  };

  const handleStartReplace = () => {
    setDraftKey("");
    setKeyVisible(false);
    setSaveError(null);
    setIsEditing(true);
  };

  const handleCancelEdit = () => {
    setDraftKey("");
    setSaveError(null);
    setIsEditing(false);
  };

  const handleConfirmDelete = () => {
    setPendingDelete(false);
    deleteProviderKey().catch((error: unknown) => {
      logError("settings-delete-key", error);
    });
  };

  /**
   * The checkbox's checked state is always bound directly to
   * avoidFerriesByDefault, itself derived from the live-query-resolved
   * persisted value — never a separate optimistic local flag. A save in
   * flight, or one that fails, can therefore never make the control
   * appear to have already succeeded: the DOM only changes once the write
   * has actually committed and the liveQuery subscription re-emits. No
   * revert-on-failure logic is needed, since nothing is ever mutated
   * locally ahead of the write landing.
   */
  const handleToggleAvoidFerriesByDefault = (checked: boolean) => {
    setPreferencesError(null);
    setIsSavingPreferences(true);
    savePlanningPreferences({ avoidFerriesByDefault: checked })
      .then(() => {
        setIsSavingPreferences(false);
      })
      .catch((error: unknown) => {
        logError("settings-save-planning-preferences", error);
        setIsSavingPreferences(false);
        setPreferencesError(
          "This preference could not be saved on this device. Try again.",
        );
      });
  };

  // key is undefined both while the live query is still loading and when
  // no key has ever been saved — like the rest of this codebase's
  // useLiveQuery consumers (e.g. RouteLibrary), that brief, imperceptible
  // ambiguity is accepted rather than adding a second loading concept.
  const showForm = !key || isEditing;
  const status = describeProviderKeyStatus(key, verification, now);

  return (
    <section className="screen" aria-label="Settings">
      <h1 className="screen-title">Settings</h1>

      {!online ? (
        <p role="status" className="status-row status-row--info">
          Offline — you can still view or edit your saved key, but calculating a route
          needs a connection.
        </p>
      ) : null}

      <section className="panel stack" aria-labelledby="route-planning-heading">
        <h2 id="route-planning-heading">Route planning</h2>
        <label className="setting-row" htmlFor="avoid-ferries-default-checkbox">
          <input
            id="avoid-ferries-default-checkbox"
            type="checkbox"
            className="setting-row-checkbox"
            // Overrides the otherwise-computed accessible name (which
            // would concatenate the title AND the hint sentence below,
            // since both live inside this same <label>) with just the
            // concise title — the whole row, hint included, still
            // activates the checkbox on click/tap via the native <label>
            // wrapping behaviour; aria-label only affects how assistive
            // technology announces the control's name.
            aria-label="Avoid ferries by default"
            checked={avoidFerriesByDefault}
            onChange={(event) => {
              handleToggleAvoidFerriesByDefault(event.target.checked);
            }}
          />
          <span className="setting-row-text">
            <span className="setting-row-title">Avoid ferries by default</span>
            <span className="field-hint">Used when a new plan is created.</span>
          </span>
        </label>
        {isSavingPreferences ? (
          <p role="status" className="field-hint">
            Saving…
          </p>
        ) : null}
        {preferencesError ? (
          <p role="alert" className="field-error">
            {preferencesError}
          </p>
        ) : null}
      </section>

      <section className="panel stack" aria-labelledby="ors-settings-heading">
        <h2 id="ors-settings-heading">OpenRouteService</h2>
        <p>
          Road-bike route planning uses your own free key from{" "}
          <a href="https://account.heigit.org/signup" target="_blank" rel="noreferrer">
            HeiGIT — sign up for an OpenRouteService key
          </a>
          , obtained from the HeiGIT account dashboard, then pasted below.
        </p>

        <p role="status" className="status-row">
          {status.headline}
        </p>

        {showForm ? (
          <form onSubmit={handleSave} className="stack">
            <label htmlFor="ors-key-input">OpenRouteService API key</label>
            <div className="row">
              <input
                id="ors-key-input"
                type={keyVisible ? "text" : "password"}
                value={draftKey}
                autoComplete="off"
                onChange={(event) => {
                  setDraftKey(event.target.value);
                }}
              />
              <button
                type="button"
                className="btn-secondary"
                aria-pressed={keyVisible}
                onClick={() => {
                  setKeyVisible((visible) => !visible);
                }}
              >
                {keyVisible ? "Hide" : "Reveal"}
              </button>
            </div>
            {saveError ? (
              <p role="alert" className="field-error">
                {saveError}
              </p>
            ) : null}
            <div className="row">
              <button
                type="submit"
                className="btn-primary"
                disabled={draftKey.trim().length === 0}
              >
                Save on this device
              </button>
              {isEditing && key ? (
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={handleCancelEdit}
                >
                  Cancel
                </button>
              ) : null}
            </div>
          </form>
        ) : (
          <div className="stack">
            <p className="status-row">Key saved on this device: •••• (hidden)</p>
            <div className="row">
              <button
                type="button"
                className="btn-secondary"
                onClick={handleStartReplace}
              >
                Replace key
              </button>
              <button
                type="button"
                className="btn-danger"
                onClick={() => {
                  setPendingDelete(true);
                }}
              >
                Delete key
              </button>
            </div>
          </div>
        )}

        <details className="settings-disclosure">
          <summary>How the key and route data are used</summary>
          <p>
            When you calculate a route in Planning, your key and the waypoints you have
            placed are sent directly to HeiGIT to compute the route. Your riding GPS
            location is never sent to HeiGIT.
          </p>
          <p>
            This is <strong>not encrypted</strong>. It is stored on this device only to
            keep it out of this app&apos;s source code and away from accidental
            publication — any JavaScript running on this site can still read it. Clearing
            Safari&apos;s or your browser&apos;s site data for this app removes it, and
            you will need to enter it again.
          </p>
        </details>
      </section>

      <ConfirmDialog
        open={pendingDelete}
        title="Delete OpenRouteService key"
        message="This removes your saved key from this device. Route planning will be unavailable until you enter a key again. Any routes you have already saved remain fully usable without it."
        confirmLabel="Delete"
        onConfirm={handleConfirmDelete}
        onCancel={() => {
          setPendingDelete(false);
        }}
      />
    </section>
  );
}
