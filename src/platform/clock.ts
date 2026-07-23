import { useEffect, useState } from "react";

export interface Clock {
  now(): number;
}

export const systemClock: Clock = {
  now: () => Date.now(),
};

/** Ticks once a second purely so elapsed-time text stays current without needing a fresh external event. */
export function useNow(clock: Clock = systemClock): number {
  const [now, setNow] = useState(() => clock.now());
  useEffect(() => {
    const intervalId = setInterval(() => {
      setNow(clock.now());
    }, 1000);
    return () => {
      clearInterval(intervalId);
    };
  }, [clock]);
  return now;
}
