import { useEffect, useState } from "react";

/**
 * Returns the current epoch ms, re-rendering the consumer every `intervalMs`.
 * Used to refresh "…s ago" / freshness labels without polling the server.
 * The interval is always cleared on unmount — no stray timers after navigation.
 */
export function useNow(intervalMs = 1_000): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);

  return now;
}
