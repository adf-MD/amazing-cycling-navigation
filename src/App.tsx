import { useState } from "react";
import type { PlannedRoute } from "./domain/types.ts";
import { usePwaUpdate } from "./pwa/registerSW.ts";
import { DiagnosticsScreen } from "./ui/diagnostics/DiagnosticsScreen.tsx";
import { RouteLibrary } from "./ui/library/RouteLibrary.tsx";
import { PlanningScreen } from "./ui/planning/PlanningScreen.tsx";
import { RidingScreen } from "./ui/riding/RidingScreen.tsx";
import { SettingsScreen } from "./ui/settings/SettingsScreen.tsx";
import { MainNavigation, type Screen } from "./ui/shared/MainNavigation.tsx";

function App() {
  const [screen, setScreen] = useState<Screen>("library");
  const [selectedRoute, setSelectedRoute] = useState<PlannedRoute | null>(null);
  const { needRefresh, offlineReady, updateNow, dismiss } = usePwaUpdate();

  const handleOpenRoute = (route: PlannedRoute) => {
    setSelectedRoute(route);
    setScreen("riding");
  };

  const handleRouteSaved = (route: PlannedRoute) => {
    setSelectedRoute(route);
    setScreen("riding");
  };

  const handleNavigateToSettings = () => {
    setScreen("settings");
  };

  return (
    <div className="app-shell">
      <header>
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
        {screen === "library" && <RouteLibrary onOpenRoute={handleOpenRoute} />}
        {screen === "riding" &&
          (selectedRoute ? (
            <RidingScreen route={selectedRoute} />
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
