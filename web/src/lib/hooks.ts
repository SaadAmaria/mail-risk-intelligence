import { useCallback, useEffect, useRef, useState } from "react";
import { isAbort } from "./api";

export interface Resource<T> {
  data: T | null;
  error: Error | null;
  /** True only until the first result for the current inputs arrives. */
  loading: boolean;
  /** True while a background refresh is running (stale data stays on screen). */
  refreshing: boolean;
  reload: () => void;
}

/**
 * Fetches `load(signal)` whenever `deps` change, cancelling the previous request. Existing data
 * stays visible during a refresh so polling never makes the screen flicker or jump.
 */
export function useResource<T>(load: (signal: AbortSignal) => Promise<T>, deps: unknown[]): Resource<T> {
  const [state, setState] = useState<{ data: T | null; error: Error | null; loading: boolean; refreshing: boolean }>({
    data: null,
    error: null,
    loading: true,
    refreshing: false,
  });
  const [tick, setTick] = useState(0);
  const loadRef = useRef(load);
  loadRef.current = load;
  const depsKey = JSON.stringify(deps);
  const lastDeps = useRef(depsKey);

  useEffect(() => {
    const inputsChanged = lastDeps.current !== depsKey;
    lastDeps.current = depsKey;
    const ctrl = new AbortController();
    setState((s) => ({
      data: inputsChanged ? null : s.data,
      error: null,
      loading: inputsChanged || s.data === null,
      refreshing: !inputsChanged && s.data !== null,
    }));
    loadRef
      .current(ctrl.signal)
      .then((data) => {
        if (!ctrl.signal.aborted) setState({ data, error: null, loading: false, refreshing: false });
      })
      .catch((err: unknown) => {
        if (ctrl.signal.aborted || isAbort(err)) return;
        setState((s) => ({
          data: s.data,
          error: err instanceof Error ? err : new Error(String(err)),
          loading: false,
          refreshing: false,
        }));
      });
    return () => ctrl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [depsKey, tick]);

  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { ...state, reload };
}

/**
 * Calls `tick` every `ms` while `active` is true and the tab is visible. Used only to read
 * progress of work the user already started; it never starts analysis.
 */
export function usePolling(tick: () => void, active: boolean, ms: number): void {
  const ref = useRef(tick);
  ref.current = tick;
  useEffect(() => {
    if (!active) return;
    const id = window.setInterval(() => {
      if (document.visibilityState === "visible") ref.current();
    }, ms);
    return () => window.clearInterval(id);
  }, [active, ms]);
}

/** Debounced copy of a value. */
export function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = window.setTimeout(() => setV(value), ms);
    return () => window.clearTimeout(id);
  }, [value, ms]);
  return v;
}

/** True when the viewport is at least `px` wide. */
export function useMinWidth(px: number): boolean {
  const query = `(min-width: ${px}px)`;
  const [match, setMatch] = useState(() => typeof window !== "undefined" && window.matchMedia?.(query).matches);
  useEffect(() => {
    if (!window.matchMedia) return;
    const mq = window.matchMedia(query);
    const on = () => setMatch(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, [query]);
  return Boolean(match);
}
