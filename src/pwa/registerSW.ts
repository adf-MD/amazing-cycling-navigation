import { useRegisterSW } from "virtual:pwa-register/react";

export interface PwaUpdateState {
  needRefresh: boolean;
  /** Applies the waiting service worker and reloads. Only ever called from an explicit user tap. */
  updateNow: () => void;
  /** Dismisses the current update-ready notice without applying it. */
  dismiss: () => void;
}

export function usePwaUpdate(): PwaUpdateState {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW();

  return {
    needRefresh,
    updateNow: () => {
      void updateServiceWorker(true);
    },
    dismiss: () => {
      setNeedRefresh(false);
    },
  };
}
