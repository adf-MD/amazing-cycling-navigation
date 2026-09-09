import { useId, type KeyboardEvent, type RefObject } from "react";
import { tagIdentityKey } from "../../domain/routeTags.ts";
import {
  describeTagLifecyclePreview,
  type TagLifecycleConfirmation,
} from "./tagLifecycleMessages.ts";
import { findTagSpelling, resolveTagLifecycleTarget } from "./tagLifecycleTarget.ts";

export interface RouteTagManagerProps {
  /** Every tag in the FULL unfiltered route corpus, in display order —
   * never the searched or tag-filtered view. */
  tags: readonly string[];
  /** Route counts per tag identity, also from the full corpus. */
  routeCountsByTagKey: ReadonlyMap<string, number>;
  /** Already resolved by RouteLibrary via resolveEffectiveSourceKey, so
   * the panel and the operation can never disagree about which tag is
   * selected. "" is the neutral placeholder. */
  sourceKey: string;
  newName: string;
  isBusy: boolean;
  errorMessage: string | null;
  confirmation: TagLifecycleConfirmation | null;
  onSourceKeyChange: (key: string) => void;
  onNewNameChange: (value: string) => void;
  onRenameRequest: () => void;
  onDeleteRequest: () => void;
  onConfirm: () => void;
  onCancelConfirm: () => void;
  onClose: () => void;
  selectRef?: RefObject<HTMLSelectElement | null>;
  renameButtonRef?: RefObject<HTMLButtonElement | null>;
  deleteButtonRef?: RefObject<HTMLButtonElement | null>;
  closeButtonRef?: RefObject<HTMLButtonElement | null>;
}

/**
 * The compact global tag manager (backlog item 100 stage 4A): rename,
 * merge and delete a tag across every saved route. Purely presentational
 * — all state, the repository call and the filter reconciliation live in
 * RouteLibrary.tsx, mirroring how RouteListItem is driven.
 *
 * The source picker is a native <select> rather than a grid of toggle
 * buttons, and the reason is accessible-name collisions rather than
 * layout: an open card editor's suggestion button and this screen's tag
 * filter chip can already share a name (see RouteLibrary.test.tsx's own
 * group-scoped chip lookup, and .tag-filter-chip's note in index.css), so
 * a third set of buttons named "Gravel" would make existing queries
 * ambiguous. <option>s are not buttons, so nothing collides. It also
 * starts on a neutral "Choose a tag" placeholder rather than
 * auto-selecting the first tag, matching the pre-ride climb selector's
 * own established behaviour.
 *
 * The confirmation is hand-rolled here rather than reusing
 * ui/shared/ConfirmDialog.tsx, mirroring RouteListItem's own per-card
 * delete confirmation (which that shared component's doc comment itself
 * cites as its precedent): ConfirmDialog hardcodes
 * aria-labelledby="confirm-dialog-title", and App.tsx can render its own
 * page-level ConfirmDialog for a pending ride switch while the Route
 * Library is on screen, so two dialogs could share one id. useId() here
 * makes that impossible.
 */
export function RouteTagManager({
  tags,
  routeCountsByTagKey,
  sourceKey,
  newName,
  isBusy,
  errorMessage,
  confirmation,
  onSourceKeyChange,
  onNewNameChange,
  onRenameRequest,
  onDeleteRequest,
  onConfirm,
  onCancelConfirm,
  onClose,
  selectRef,
  renameButtonRef,
  deleteButtonRef,
  closeButtonRef,
}: RouteTagManagerProps) {
  const headingId = useId();
  const selectId = useId();
  const newNameId = useId();
  const confirmHeadingId = useId();
  const confirmDescriptionId = useId();

  const sourceTag = sourceKey === "" ? null : findTagSpelling(tags, sourceKey);
  const { targetSpelling, isMerge } = resolveTagLifecycleTarget(tags, sourceKey, newName);
  const routeCount = routeCountsByTagKey.get(sourceKey) ?? 0;
  const controlsDisabled = isBusy || confirmation !== null;
  const hasSource = sourceTag !== null;

  const handleConfirmKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      onCancelConfirm();
    }
  };

  return (
    <div className="tag-manager stack" role="group" aria-labelledby={headingId}>
      <h2 id={headingId}>Manage tags</h2>

      {tags.length === 0 ? (
        <>
          <p>No tags left. Add tags from a route to manage them here.</p>
          <button
            type="button"
            className="btn-secondary"
            ref={closeButtonRef}
            onClick={onClose}
          >
            Close
          </button>
        </>
      ) : (
        <>
          <div className="route-library-field">
            <label htmlFor={selectId}>Tag to manage</label>
            <select
              id={selectId}
              className="tag-manager-select"
              ref={selectRef}
              value={sourceKey}
              disabled={controlsDisabled}
              onChange={(event) => {
                onSourceKeyChange(event.target.value);
              }}
            >
              <option value="">Choose a tag</option>
              {tags.map((tag) => {
                const key = tagIdentityKey(tag);
                const count = routeCountsByTagKey.get(key) ?? 0;
                return (
                  <option key={key} value={key}>
                    {`${tag} (${count === 1 ? "1 route" : `${String(count)} routes`})`}
                  </option>
                );
              })}
            </select>
          </div>

          <div className="route-library-field">
            <label htmlFor={newNameId}>New name</label>
            <input
              id={newNameId}
              type="text"
              className="field-input"
              value={newName}
              disabled={controlsDisabled || !hasSource}
              onChange={(event) => {
                onNewNameChange(event.target.value);
              }}
            />
          </div>

          {hasSource ? (
            <p className="field-hint">
              {describeTagLifecyclePreview({
                sourceTag,
                targetTag: targetSpelling,
                isMerge,
                routeCount,
              })}
            </p>
          ) : (
            <p className="field-hint">
              Choose a tag to rename, merge or delete it everywhere it is used.
            </p>
          )}

          {isBusy ? (
            <p role="status" className="field-hint">
              Applying…
            </p>
          ) : null}
          {errorMessage ? (
            <p role="alert" className="field-error">
              {errorMessage}
            </p>
          ) : null}

          <div className="row">
            <button
              type="button"
              className="btn-primary"
              ref={renameButtonRef}
              disabled={controlsDisabled || !hasSource}
              onClick={onRenameRequest}
            >
              {isMerge ? "Merge tags" : "Rename tag"}
            </button>
            <button
              type="button"
              className="btn-danger"
              ref={deleteButtonRef}
              disabled={controlsDisabled || !hasSource}
              onClick={onDeleteRequest}
            >
              Delete tag
            </button>
            <button
              type="button"
              className="btn-secondary"
              ref={closeButtonRef}
              disabled={isBusy}
              onClick={onClose}
            >
              Close
            </button>
          </div>

          {confirmation ? (
            <div
              className="route-delete-confirm"
              role="alertdialog"
              aria-labelledby={confirmHeadingId}
              aria-describedby={confirmDescriptionId}
              onKeyDown={handleConfirmKeyDown}
            >
              <h3 id={confirmHeadingId}>{confirmation.title}</h3>
              <p id={confirmDescriptionId}>{confirmation.message}</p>
              <div className="route-delete-confirm-actions">
                <button
                  type="button"
                  className="btn-secondary"
                  autoFocus
                  disabled={isBusy}
                  onClick={onCancelConfirm}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="btn-danger"
                  disabled={isBusy}
                  onClick={onConfirm}
                >
                  {confirmation.confirmLabel}
                </button>
              </div>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
