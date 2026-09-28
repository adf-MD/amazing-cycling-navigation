import type { Ref } from "react";
import { useTranslate } from "../../i18n/useTranslate.ts";
import type { ParameterlessMessageKey } from "../../i18n/translate.ts";
import type { SettingsSectionView } from "../shared/screenTypes.ts";

const VIEWS: readonly { view: SettingsSectionView; labelKey: ParameterlessMessageKey }[] =
  [
    { view: "settings", labelKey: "nav.settings" },
    { view: "diagnostics", labelKey: "nav.status" },
  ];

export interface SettingsStatusSwitcherProps {
  view: SettingsSectionView;
  onSelectView: (view: SettingsSectionView) => void;
  /** The switcher's own box, which SettingsSection measures for the sticky
   * offsets and SettingsScreen's confirmation reveal. */
  ref?: Ref<HTMLElement>;
}

/**
 * Backlog item 121: the two-button switcher between the Settings and Status
 * views, the only route to Status now that it is not a primary destination.
 * Similar in purpose to Riding's Map/Profile switcher and visually alike,
 * but with navigation semantics rather than toggle semantics: choosing a
 * button replaces the page (its landmark and its heading), which is what
 * `aria-current="page"` inside a `<nav>` says — and it matches the primary
 * navigation directly above it. A second `<nav>` also gives Status an entry
 * in a screen reader's landmark list, now that it has no tab of its own.
 *
 * The labels reuse the navigation's own catalogue keys, so the Settings tab
 * and this switcher's Settings button can never disagree.
 *
 * Pressing the button of the view already shown does nothing. It is not
 * disabled, so it stays focusable and in the tab order. SettingsSection
 * renders this component at a fixed position whichever view is showing, so
 * after a switch the pressed button is the very same DOM node — keyboard
 * focus and the VoiceOver cursor stay on it rather than falling to <body>.
 */
export function SettingsStatusSwitcher({
  view,
  onSelectView,
  ref,
}: SettingsStatusSwitcherProps) {
  const { t } = useTranslate();
  return (
    <nav
      ref={ref}
      aria-label={t("settingsSection.switcherLabel")}
      className="settings-status-switcher"
    >
      {VIEWS.map((item) => (
        <button
          key={item.view}
          type="button"
          className="settings-status-switcher-button"
          aria-current={item.view === view ? "page" : undefined}
          onClick={() => {
            if (item.view !== view) onSelectView(item.view);
          }}
        >
          {t(item.labelKey)}
        </button>
      ))}
    </nav>
  );
}
