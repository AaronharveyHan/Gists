import { useCallback, useEffect, useRef, useState } from "react";

/**
 * A transient boolean that flips to `true` on `flash()` and auto-resets to
 * `false` after `ms`. The timer is stored in a ref, cleared on unmount, and
 * re-armed on every `flash()` — so there is no setState on an unmounted
 * component and no overlapping timers when triggered repeatedly.
 *
 * Designed for "Copied!" / "Saved!" feedback flags.
 *
 * @example
 *   const [copied, flashCopied] = useFlashFlag(1500);
 *   const onCopy = () => { writeText(text); flashCopied(); };
 */
export function useFlashFlag(ms = 1500): [boolean, () => void] {
  const [on, setOn] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const flash = useCallback(() => {
    setOn(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setOn(false), ms);
  }, [ms]);

  return [on, flash];
}
