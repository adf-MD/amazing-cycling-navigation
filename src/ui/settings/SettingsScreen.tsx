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

  const now = useNow(clock);
  const online = useOnlineStatus();

  const [draftKey, setDraftKey] = useState("");
  const [keyVisible, setKeyVisible] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [pendingDelete, setPendingDelete] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

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

  // key is undefined both while the live query is still loading and when
  // no key has ever been saved — like the rest of this codebase's
  // useLiveQuery consumers (e.g. RouteLibrary), that brief, imperceptible
  // ambiguity is accepted rather than adding a second loading concept.
  const showForm = !key || isEditing;
  const status = describeProviderKeyStatus(key, verification, now);

  return (
    <section aria-label="Settings">
      <h1 className="screen-title">Settings</h1>

      {!online ? (
        <p role="status">
          Offline — you can still view or edit your saved key, but calculating a route
          needs a connection.
        </p>
      ) : null}

      <section aria-labelledby="ors-settings-heading">
        <h2 id="ors-settings-heading">OpenRouteService</h2>
        <p>
          Road-bike route planning uses your own free key from{" "}
          <a href="https://account.heigit.org/signup" target="_blank" rel="noreferrer">
            HeiGIT — sign up for an OpenRouteService key
          </a>
          , obtained from the HeiGIT account dashboard, then pasted below.
        </p>
        <p>
          When you calculate a route in Planning, your key and the waypoints you have
          placed are sent directly to HeiGIT to compute the route. Your riding GPS
          location is never sent to HeiGIT.
        </p>
        <p>
          This is <strong>not encrypted</strong>. It is stored on this device only to keep
          it out of this app&apos;s source code and away from accidental publication — any
          JavaScript running on this site can still read it. Clearing Safari&apos;s or
          your browser&apos;s site data for this app removes it, and you will need to
          enter it again.
        </p>

        <p role="status">{status.headline}</p>

        {showForm ? (
          <form onSubmit={handleSave}>
            <label htmlFor="ors-key-input">OpenRouteService API key</label>
            <div>
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
                aria-pressed={keyVisible}
                onClick={() => {
                  setKeyVisible((visible) => !visible);
                }}
              >
                {keyVisible ? "Hide" : "Reveal"}
              </button>
            </div>
            {saveError ? <p role="alert">{saveError}</p> : null}
            <button type="submit" disabled={draftKey.trim().length === 0}>
              Save on this device
            </button>
            {isEditing && key ? (
              <button type="button" onClick={handleCancelEdit}>
                Cancel
              </button>
            ) : null}
          </form>
        ) : (
          <div>
            <p>Key saved on this device: •••• (hidden)</p>
            <button type="button" onClick={handleStartReplace}>
              Replace key
            </button>
            <button
              type="button"
              onClick={() => {
                setPendingDelete(true);
              }}
            >
              Delete key
            </button>
          </div>
        )}
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
