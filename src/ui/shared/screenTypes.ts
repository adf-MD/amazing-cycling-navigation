export type Screen = "library" | "riding" | "diagnostics" | "planning" | "settings";

/**
 * Backlog item 121. The four destinations the primary navigation offers:
 * Status is no longer one of them. It is reached through the
 * Settings/Status switcher, as a sibling view of Settings within the
 * Settings section. `Screen` itself is unchanged, and "diagnostics" stays
 * the internal key for Status, as item 112 established; derived here, so
 * the two unions cannot drift apart.
 */
export type PrimaryDestination = Exclude<Screen, "diagnostics">;

/** The two sibling views reached through the Settings tab. */
export type SettingsSectionView = Extract<Screen, "settings" | "diagnostics">;

export function isSettingsSectionView(screen: Screen): screen is SettingsSectionView {
  return screen === "settings" || screen === "diagnostics";
}

/**
 * Where the Settings tab takes the rider (backlog item 121, as decided with
 * the rider on 28 September 2026):
 *
 * - from inside the section, always to Settings — so tapping the tab while
 *   Status is showing opens Settings, and tapping it while Settings is
 *   already showing changes nothing;
 * - from any other tab, back to whichever sibling view was last shown in
 *   this app session. `lastView` is held in memory only, so a reload starts
 *   at Settings.
 */
export function resolveSettingsTabTarget(
  screen: Screen,
  lastView: SettingsSectionView,
): SettingsSectionView {
  return isSettingsSectionView(screen) ? "settings" : lastView;
}

/**
 * `aria-current` for one primary-navigation destination. The Settings tab
 * stands for the whole Settings section, so it is current on Status too —
 * but there it is the section that is current, not the page the tab itself
 * opens (the tab opens Settings from Status), so it carries `true` rather
 * than `page` (backlog item 121).
 */
export function navCurrentState(
  destination: PrimaryDestination,
  screen: Screen,
): "page" | "true" | undefined {
  if (destination === "settings" && screen === "diagnostics") return "true";
  return destination === screen ? "page" : undefined;
}
