import { useRegisterSW } from "virtual:pwa-register/react";

export interface PwaUpdateState {
  needRefresh: boolean;
  offlineReady: boolean;
  /** Applies the waiting service worker and reloads. Only ever called from an explicit user tap. */
  updateNow: () => void;
  /** Dismisses the current offline-ready/need-refresh notice without applying anything. */
  dismiss: () => void;
}

export function usePwaUpdate(): PwaUpdateState {
  const {
    offlineReady: [offlineReady, setOfflineReady],
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW();

  return {
    needRefresh,
    offlineReady,
    updateNow: () => {
      void updateServiceWorker(true);
    },
    dismiss: () => {
      setOfflineReady(false);
      setNeedRefresh(false);
    },
  };
}
