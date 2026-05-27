import { useEffect, useRef } from "react";

/**
 * Returns a debounced version of `fn`.
 * Used for auto-save path: fire Rust update only after user stops typing.
 */
export function useDebounce<Args extends unknown[]>(
  fn: (...args: Args) => void | Promise<void>,
  delay: number
): (...args: Args) => void {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fnRef = useRef(fn);
  fnRef.current = fn;

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  return (...args: Args) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      void fnRef.current(...args);
    }, delay);
  };
}
