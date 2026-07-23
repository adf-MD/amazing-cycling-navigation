import { useEffect, useState } from "react";

export type GeolocationPermissionStatus = "granted" | "denied" | "prompt" | "unsupported";

function isSupported(): boolean {
  return "permissions" in navigator && "geolocation" in navigator;
}

/** Reads persistent browser permission state — independent of whether a watch is currently active — via the Permissions API where available. */
export function useGeolocationPermissionStatus(): GeolocationPermissionStatus {
  const [status, setStatus] = useState<GeolocationPermissionStatus>(() =>
    isSupported() ? "prompt" : "unsupported",
  );

  useEffect(() => {
    if (!isSupported()) return;
    let cancelled = false;
    let permissionStatus: PermissionStatus | undefined;

    const handleChange = () => {
      if (!cancelled && permissionStatus) {
        setStatus(permissionStatus.state);
      }
    };

    navigator.permissions
      .query({ name: "geolocation" })
      .then((result) => {
        if (cancelled) return;
        permissionStatus = result;
        setStatus(result.state);
        result.addEventListener("change", handleChange);
      })
      .catch(() => {
        if (!cancelled) setStatus("unsupported");
      });

    return () => {
      cancelled = true;
      permissionStatus?.removeEventListener("change", handleChange);
    };
  }, []);

  return status;
}
