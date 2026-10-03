import { useEffect, useRef } from "react";

const KEY_GUARD_MS = 300;

export function useKeyGuard(): (e: React.KeyboardEvent) => boolean {
  const mountedAt = useRef(0);
  useEffect(() => {
    mountedAt.current = Date.now();
  }, []);
  return (e) => e.repeat || Date.now() - mountedAt.current < KEY_GUARD_MS;
}

export const kbdClass =
  "border-border/60 bg-muted/60 text-current rounded border px-1 py-0.5 font-mono text-2xs font-semibold";
