import { useState } from "react";
import type { PlannedRoute } from "./domain/types.ts";
import { usePwaUpdate } from "./pwa/registerSW.ts";
import { DiagnosticsScreen } from "./ui/diagnostics/DiagnosticsScreen.tsx";
import { RouteLibrary } from "./ui/library/RouteLibrary.tsx";
import { RidingScreen } from "./ui/riding/RidingScreen.tsx";

type Screen = "library" | "riding" | "diagnostics";

function App() {
  const [screen, setScreen] = useState<Screen>("library");
  const [selectedRoute, setSelectedRoute] = useState<PlannedRoute | null>(null);
  const { needRefresh, offlineReady, updateNow, dismiss } = usePwaUpdate();

  const handleOpenRoute = (route: PlannedRoute) => {
    setSelectedRoute(route);
    setScreen("riding");
  };

  return (
    <div className="app-shell">
      <header>
        <h1>Amazing Cycling Navigation</h1>
        <nav aria-label="Main">
          <button
            type="button"
            aria-current={screen === "library" ? "page" : undefined}
            onClick={() => {
              setScreen("library");
            }}
          >
            Routes
          </button>
          <button
            type="button"
            aria-current={screen === "riding" ? "page" : undefined}
            onClick={() => {
              setScreen("riding");
            }}
          >
            Ride
          </button>
          <button
            type="button"
            aria-current={screen === "diagnostics" ? "page" : undefined}
            onClick={() => {
              setScreen("diagnostics");
            }}
          >
            Diagnostics
          </button>
        </nav>
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
            <p>Select a route from the library to start riding.</p>
          ))}
        {screen === "diagnostics" && <DiagnosticsScreen />}
      </main>
    </div>
  );
}

export default App;
