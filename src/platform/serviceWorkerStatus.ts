import { useEffect, useState } from "react";

export type ServiceWorkerStatus =
  "unsupported" | "not-registered" | "installing" | "waiting" | "active" | "unknown";

function isSupported(): boolean {
  return "serviceWorker" in navigator;
}

export function useServiceWorkerStatus(): ServiceWorkerStatus {
  const [status, setStatus] = useState<ServiceWorkerStatus>(() =>
    isSupported() ? "unknown" : "unsupported",
  );

  useEffect(() => {
    if (!isSupported()) return;
    let cancelled = false;

    const readStatus = () => {
      navigator.serviceWorker
        .getRegistration()
        .then((registration) => {
          if (cancelled) return;
          if (!registration) {
            setStatus("not-registered");
          } else if (registration.installing) {
            setStatus("installing");
          } else if (registration.waiting) {
            setStatus("waiting");
          } else if (registration.active) {
            setStatus("active");
          } else {
            setStatus("unknown");
          }
        })
        .catch(() => {
          if (!cancelled) setStatus("unknown");
        });
    };

    readStatus();
    navigator.serviceWorker.addEventListener("controllerchange", readStatus);
    return () => {
      cancelled = true;
      navigator.serviceWorker.removeEventListener("controllerchange", readStatus);
    };
  }, []);

  return status;
}
