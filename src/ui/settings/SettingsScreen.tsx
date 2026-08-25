import { useCallback, useRef, useState, type SubmitEvent } from "react";
import type { RoutingProfile } from "../../domain/types.ts";
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
import {
  DEFAULT_ROUTING_PROFILE,
  ROUTING_PROFILES,
  describeRoutingProfile,
} from "../../routing/routingProfiles.ts";
import {
  CLIMB_CATEGORY_1_SCORE,
  CLIMB_CATEGORY_2_SCORE,
  CLIMB_CATEGORY_3_SCORE,
  CLIMB_CATEGORY_4_SCORE,
  CLIMB_CATEGORY_HC_SCORE,
  CLIMB_GRADIENT_BAND_SEVERITY_ORDER,
  DESCENT_LOCAL_KEY_SEVERITY_ORDER,
  MIN_CLIMB_AVERAGE_GRADIENT_PERCENT,
  MIN_CLIMB_SCORE,
  MIN_FEATURE_LENGTH_METRES,
  type ClimbGradientBand,
  type DescentLocalKey,
} from "../../navigation/routeFeatures.ts";
import { CLIMB_CATEGORY_NAMES } from "../../navigation/routeFeaturePalette.ts";
import { ClimbGradientBandLegend } from "../shared/ClimbGradientBandLegend.tsx";
import { DescentLocalLegend } from "../shared/DescentLocalLegend.tsx";
import { formatMetres, formatWholeNumber } from "../shared/routeSummary.ts";
import { useLiveQuery } from "../shared/useLiveQuery.ts";
import { ConfirmDialog } from "../shared/ConfirmDialog.tsx";
import { describeProviderKeyStatus } from "./providerKeyStatus.ts";

// The complete climb/descent local-gradient palettes, for Settings' own
// always-full "Local gradient colours" disclosure (backlog item 79) —
// independent of whatever route/feature is currently open, unlike the
// pre-ride selected-feature disclosures' present-only sets. Module-level
// so these aren't reconstructed on every render.
const ALL_CLIMB_GRADIENT_BANDS: ReadonlySet<ClimbGradientBand> = new Set(
  CLIMB_GRADIENT_BAND_SEVERITY_ORDER,
);
const ALL_DESCENT_LOCAL_KEYS: ReadonlySet<DescentLocalKey> = new Set(
  DESCENT_LOCAL_KEY_SEVERITY_ORDER,
);

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

  // avoidFerriesByDefault/profileByDefault are undefined both while the
  // live query is still loading and when no preferences row has ever been
  // saved — resolved to the app's own documented defaults (true,
  // DEFAULT_ROUTING_PROFILE) either way, matching
  // fromStoredPlanningPreferences's own no-row/legacy-row defaults.
  const avoidFerriesByDefault = preferences?.avoidFerriesByDefault ?? true;
  const profileByDefault = preferences?.profileByDefault ?? DEFAULT_ROUTING_PROFILE;
  const [isSavingPreferences, setIsSavingPreferences] = useState(false);
  // Synchronous duplicate-submission guard, mirroring isSavingRef/
  // isLocatingRef elsewhere in this codebase — a React state check alone
  // isn't synchronous enough to block a rapid second click/tap before the
  // disabled attribute has actually committed to the DOM.
  const isSavingPreferencesRef = useRef(false);
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
   * Both controls' state is always bound directly to
   * avoidFerriesByDefault/profileByDefault, themselves derived from the
   * live-query-resolved persisted value — never a separate optimistic
   * local flag. A save in flight, or one that fails, can therefore never
   * make either control appear to have already succeeded: the DOM only
   * changes once the write has actually committed and the liveQuery
   * subscription re-emits. No revert-on-failure logic is needed, since
   * nothing is ever mutated locally ahead of the write landing.
   *
   * Shared by both controls (rather than one handler per field) so a
   * write always carries the *complete* resolved preferences object —
   * savePlanningPreferences does a full put, not a merge, so writing only
   * the field that changed would silently reset the other one back to
   * whatever it happened to default to. isSavingPreferencesRef also
   * serialises the two controls against each other: a click on either one
   * while the other's write is still in flight is a no-op, which is what
   * actually prevents two overlapping writes from clobbering one another
   * (each capturing the *other* field's pre-write value in its own
   * closure). Both controls are additionally disabled via isSavingPreferences
   * while a write is in flight, so this is belt-and-braces once React has
   * had a chance to re-render.
   */
  const savePreferences = (next: {
    avoidFerriesByDefault: boolean;
    profileByDefault: RoutingProfile;
  }) => {
    if (isSavingPreferencesRef.current) return;
    isSavingPreferencesRef.current = true;
    setPreferencesError(null);
    setIsSavingPreferences(true);
    savePlanningPreferences(next)
      .then(() => {
        isSavingPreferencesRef.current = false;
        setIsSavingPreferences(false);
      })
      .catch((error: unknown) => {
        logError("settings-save-planning-preferences", error);
        isSavingPreferencesRef.current = false;
        setIsSavingPreferences(false);
        setPreferencesError(
          "This preference could not be saved on this device. Try again.",
        );
      });
  };

  const handleToggleAvoidFerriesByDefault = (checked: boolean) => {
    savePreferences({ avoidFerriesByDefault: checked, profileByDefault });
  };

  const handleChangeDefaultProfile = (nextProfile: RoutingProfile) => {
    savePreferences({ avoidFerriesByDefault, profileByDefault: nextProfile });
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

        <div className="stack">
          <p className="setting-row-title" id="default-cycling-profile-heading">
            Default cycling profile
          </p>
          <div
            role="group"
            aria-labelledby="default-cycling-profile-heading"
            className="cycling-profile-group"
          >
            {ROUTING_PROFILES.map((metadata) => {
              const isSelected = profileByDefault === metadata.value;
              return (
                <button
                  key={metadata.value}
                  type="button"
                  className={
                    isSelected
                      ? "cycling-profile-button is-selected"
                      : "cycling-profile-button"
                  }
                  aria-pressed={isSelected}
                  disabled={isSavingPreferences}
                  onClick={() => {
                    handleChangeDefaultProfile(metadata.value);
                  }}
                >
                  {metadata.label}
                </button>
              );
            })}
          </div>
          <p className="field-hint">{describeRoutingProfile(profileByDefault)}</p>
        </div>

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
            disabled={isSavingPreferences}
            onChange={(event) => {
              handleToggleAvoidFerriesByDefault(event.target.checked);
            }}
          />
          <span className="setting-row-text">
            <span className="setting-row-title">Avoid ferries by default</span>
            <span className="field-hint">Used when a new draft is created.</span>
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

        <details className="settings-disclosure">
          <summary>How recalculation works</summary>
          <p>
            A route is calculated in sections between waypoints. The first calculation
            uses one routing request per section; later edits normally recalculate only
            changed sections.
          </p>
        </details>
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

      <section className="panel stack" aria-labelledby="elevation-climbs-heading">
        <h2 id="elevation-climbs-heading">Elevation and climbs</h2>

        <details className="settings-disclosure">
          <summary>How climbs are classified</summary>
          <p>
            Climb score is climb length in metres multiplied by average gradient
            percentage.
          </p>
          <p>
            A climb is recognised once it is at least{" "}
            {formatMetres(MIN_FEATURE_LENGTH_METRES)} long, averages at least{" "}
            {MIN_CLIMB_AVERAGE_GRADIENT_PERCENT}% and reaches a minimum score of{" "}
            {formatWholeNumber(MIN_CLIMB_SCORE)}.
          </p>
          <ul>
            <li>Uncategorised: below {formatWholeNumber(CLIMB_CATEGORY_4_SCORE)}</li>
            <li>
              {CLIMB_CATEGORY_NAMES["category-4"]}:{" "}
              {formatWholeNumber(CLIMB_CATEGORY_4_SCORE)} to{" "}
              {formatWholeNumber(CLIMB_CATEGORY_3_SCORE - 1)}
            </li>
            <li>
              {CLIMB_CATEGORY_NAMES["category-3"]}:{" "}
              {formatWholeNumber(CLIMB_CATEGORY_3_SCORE)} to{" "}
              {formatWholeNumber(CLIMB_CATEGORY_2_SCORE - 1)}
            </li>
            <li>
              {CLIMB_CATEGORY_NAMES["category-2"]}:{" "}
              {formatWholeNumber(CLIMB_CATEGORY_2_SCORE)} to{" "}
              {formatWholeNumber(CLIMB_CATEGORY_1_SCORE - 1)}
            </li>
            <li>
              {CLIMB_CATEGORY_NAMES["category-1"]}:{" "}
              {formatWholeNumber(CLIMB_CATEGORY_1_SCORE)} to{" "}
              {formatWholeNumber(CLIMB_CATEGORY_HC_SCORE - 1)}
            </li>
            <li>
              {CLIMB_CATEGORY_NAMES.hc}: {formatWholeNumber(CLIMB_CATEGORY_HC_SCORE)} or
              more
            </li>
          </ul>
        </details>

        <details className="settings-disclosure">
          <summary>Local gradient colours</summary>
          <p>
            Detailed colours along a route show local gradient, smoothed over
            approximately 100 m — not a climb&apos;s overall category or a single
            point&apos;s exact grade.
          </p>
          <ClimbGradientBandLegend presentClimbBands={ALL_CLIMB_GRADIENT_BANDS} />
          <p>
            A brief flat or descending section within a recognised climb uses the green,
            below-3% band.
          </p>
          <DescentLocalLegend presentDescentLocalKeys={ALL_DESCENT_LOCAL_KEYS} />
          <p>
            A recognised descent reuses the same three blues locally; any locally shallow
            stretch shows the plain route colour instead.
          </p>
          <p>
            Blue intensity reflects gradient steepness only, not surface, bends, traffic
            or other conditions.
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
