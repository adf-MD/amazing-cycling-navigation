import { useRef, useState } from "react";
import type { PlannedRoute } from "./domain/types.ts";
import type { MapFactory } from "./map/mapAdapter.ts";
import { usePwaUpdate } from "./pwa/registerSW.ts";
import { DiagnosticsScreen } from "./ui/diagnostics/DiagnosticsScreen.tsx";
import { RouteLibrary } from "./ui/library/RouteLibrary.tsx";
import { PlanningScreen } from "./ui/planning/PlanningScreen.tsx";
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

  const handleNavigateToSettings = () => {
    setScreen("settings");
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
            />
          ) : (
            <section className="screen" aria-label="Ride">
              <h1 className="screen-title">Ride</h1>
              <p>No route selected yet. Choose a route from Routes to start riding.</p>
              <button
                type="button"
                className="btn-primary"
                onClick={() => {
                  setScreen("library");
                }}
              >
                Choose a route
              </button>
            </section>
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
