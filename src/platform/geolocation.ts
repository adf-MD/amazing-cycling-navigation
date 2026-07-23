import { useCallback, useEffect, useRef, useState } from "react";
import type { Coordinate } from "../domain/types.ts";

export interface GeolocationFix {
  coordinate: Coordinate;
  accuracyMetres: number;
  timestampMs: number;
  /** Transient; never persisted or accumulated into a speed/ride history. */
  speedMetresPerSecond: number | null;
}

export type GeolocationErrorReason =
  "permission-denied" | "position-unavailable" | "timeout" | "unsupported";

export interface GeolocationError {
  reason: GeolocationErrorReason;
  message: string;
}

/** Small DI wrapper around navigator.geolocation so core behaviour is testable without a browser. */
export interface GeolocationSource {
  watchPosition(
    onFix: (fix: GeolocationFix) => void,
    onError: (error: GeolocationError) => void,
  ): () => void;
}

function mapPositionError(error: GeolocationPositionError): GeolocationError {
  switch (error.code) {
    case error.PERMISSION_DENIED:
      return { reason: "permission-denied", message: "Location permission was denied." };
    case error.TIMEOUT:
      return { reason: "timeout", message: "Getting your location timed out." };
    case error.POSITION_UNAVAILABLE:
    default:
      return {
        reason: "position-unavailable",
        message: "Your location is currently unavailable.",
      };
  }
}

export const browserGeolocationSource: GeolocationSource = {
  watchPosition(onFix, onError) {
    if (!("geolocation" in navigator)) {
      onError({
        reason: "unsupported",
        message: "This browser does not support location services.",
      });
      return () => undefined;
    }

    const watchId = navigator.geolocation.watchPosition(
      (position) => {
        onFix({
          coordinate: [position.coords.longitude, position.coords.latitude],
          accuracyMetres: position.coords.accuracy,
          timestampMs: position.timestamp,
          speedMetresPerSecond: position.coords.speed,
        });
      },
      (error) => {
        onError(mapPositionError(error));
      },
      { enableHighAccuracy: true, maximumAge: 0 },
    );

    return () => {
      navigator.geolocation.clearWatch(watchId);
    };
  },
};

export type GeolocationWatchStatus = "idle" | "watching" | "error";

export interface GeolocationWatchState {
  status: GeolocationWatchStatus;
  fix: GeolocationFix | null;
  error: GeolocationError | null;
  start: () => void;
  stop: () => void;
}

/**
 * Never calls source.watchPosition on its own — only `start()`, which the
 * UI must wire to an explicit user action, ever requests a location watch.
 */
export function useGeolocationWatch(
  source: GeolocationSource = browserGeolocationSource,
): GeolocationWatchState {
  const [status, setStatus] = useState<GeolocationWatchStatus>("idle");
  const [fix, setFix] = useState<GeolocationFix | null>(null);
  const [error, setError] = useState<GeolocationError | null>(null);
  const clearWatchRef = useRef<(() => void) | null>(null);

  const start = useCallback(() => {
    if (clearWatchRef.current) return;
    setStatus("watching");
    setError(null);
    clearWatchRef.current = source.watchPosition(
      (nextFix) => {
        setFix(nextFix);
        setStatus("watching");
        setError(null);
      },
      (nextError) => {
        setError(nextError);
        setStatus("error");
      },
    );
  }, [source]);

  const stop = useCallback(() => {
    clearWatchRef.current?.();
    clearWatchRef.current = null;
    setStatus("idle");
  }, []);

  useEffect(() => {
    return () => {
      clearWatchRef.current?.();
    };
  }, []);

  return { status, fix, error, start, stop };
}
