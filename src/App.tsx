import { useRef, useState } from "react";
import type { PlannedRoute } from "./domain/types.ts";
import type { MapFactory } from "./map/mapAdapter.ts";
import { usePwaUpdate } from "./pwa/registerSW.ts";
import { DiagnosticsScreen } from "./ui/diagnostics/DiagnosticsScreen.tsx";
import { RouteLibrary } from "./ui/library/RouteLibrary.tsx";
import { PlanningScreen } from "./ui/planning/PlanningScreen.tsx";
import { RidingLauncher } from "./ui/riding/RidingLauncher.tsx";
import { RidingScreen } from "./ui/riding/RidingScreen.tsx";
import { SettingsScreen } from "./ui/settings/SettingsScreen.tsx";
import { MainNavigation, type Screen } from "./ui/shared/MainNavigation.tsx";
import { deriveNavPositionMode } from "./ui/shared/navPositionMode.ts";
import { useResetScrollForNewRideContent } from "./ui/shared/useResetScrollForNewRideContent.ts";

export interface AppProps {
  /** Injectable for tests, so opening a route into RidingScreen doesn't
   * mount a real, unmocked MapView (jsdom has no WebGL2 support). Defaults
   * to RidingScreen's own real MapLibre factory in production. */
  mapFactory?: MapFactory;
}

function App({ mapFactory }: AppProps) {
  const [screen, setScreen] = useState<Screen>("library");
  const [selectedRoute, setSelectedRoute] = useState<PlannedRoute | null>(null);
  const [isRidingActive, setIsRidingActive] = useState(false);
  const { needRefresh, offlineReady, updateNow, dismiss } = usePwaUpdate();
  const routesScrollYRef = useRef<number | null>(null);
  const routesSearchQueryRef = useRef<string>("");
  const notifyNewRideContent = useResetScrollForNewRideContent(screen);
  const positionMode = deriveNavPositionMode(screen, isRidingActive);

  const handleOpenRoute = (route: PlannedRoute) => {
    routesScrollYRef.current = window.scrollY;
    setSelectedRoute(route);
    setScreen("riding");
    notifyNewRideContent();
  };

  const handleRouteSaved = (route: PlannedRoute) => {
    setSelectedRoute(route);
    setScreen("riding");
    notifyNewRideContent();
  };

  // Opens a resumable route session discovered by the Ride launcher itself
  // (getActiveRideState()/getRoute()) — App.tsx never inspects persisted
  // ride state directly. Deliberately does not capture window.scrollY into
  // routesScrollYRef the way handleOpenRoute does: the rider is already on
  // the Ride screen (the launcher), not Routes, so capturing the launcher's
  // own scroll offset here would wrongly overwrite the Routes-restore ref.
  // Never starts geolocation itself.
  const handleResumeRoute = (route: PlannedRoute) => {
    setSelectedRoute(route);
    setScreen("riding");
    notifyNewRideContent();
  };

  // The sole success-path integration point from RidingScreen's shared End
  // ride/Finish ride finalisation lifecycle. Called only once nav.finish()
  // has already cleared the persisted active-ride row and RidingScreen's
  // own runtime cleanup has already applied. Clearing selectedRoute here
  // (never elsewhere) is what actually unmounts RidingScreen and mounts the
  // empty Ride launcher in its place; screen deliberately stays "riding"
  // throughout.
  const handleRideFinalized = () => {
    setSelectedRoute(null);
    notifyNewRideContent();
  };

  const handleNavigateToSettings = () => {
    setScreen("settings");
  };

  const handleNavigateToPlanning = () => {
    setScreen("planning");
  };

  return (
    <div className="app-shell">
      <header className={positionMode === "sticky" ? "app-header--sticky" : undefined}>
        <MainNavigation screen={screen} onNavigate={setScreen} />
      </header>

      {needRefresh ? (
        <div role="status">
          <p>An update is ready.</p>
          <button type="button" onClick={updateNow}>
            Update now
          </button>
          <button type="button" onClick={dismiss}>
            Later
          </button>
        </div>
      ) : null}
      {offlineReady && !needRefresh ? (
        <div role="status">
          <p>Ready to work offline.</p>
          <button type="button" onClick={dismiss}>
            Dismiss
          </button>
        </div>
      ) : null}

      <main>
        {screen === "library" && (
          <RouteLibrary
            onOpenRoute={handleOpenRoute}
            restoreScrollYRef={routesScrollYRef}
            restoreSearchQueryRef={routesSearchQueryRef}
          />
        )}
        {screen === "riding" &&
          (selectedRoute ? (
            <RidingScreen
              route={selectedRoute}
              mapFactory={mapFactory}
              onRidingActiveChange={setIsRidingActive}
              onNavigateToPlanning={handleNavigateToPlanning}
              onRideFinalized={handleRideFinalized}
            />
          ) : (
            <RidingLauncher
              onResumeRoute={handleResumeRoute}
              onChooseRoute={() => {
                setScreen("library");
              }}
            />
          ))}
        {screen === "planning" && (
          <PlanningScreen
            onNavigateToSettings={handleNavigateToSettings}
            onRouteSaved={handleRouteSaved}
          />
        )}
        {screen === "diagnostics" && <DiagnosticsScreen />}
        {screen === "settings" && <SettingsScreen />}
      </main>
    </div>
  );
}

export default App;
