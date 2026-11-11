import { useCallback, useEffect, useState } from "react";
import { api } from "@kinora/client";

/**
 * Stale-while-revalidate for GET endpoints: a page shows the last response it saw immediately,
 * then refreshes it in the background. Requests for the same path share one fetch.
 */
const store = new Map<string, unknown>();
const inflight = new Map<string, Promise<unknown>>();

function load<T>(path: string): Promise<T> {
  const pending = inflight.get(path);
  if (pending) return pending as Promise<T>;
  const request = api<T>(path)
    .then((data) => {
      store.set(path, data);
      return data;
    })
    .finally(() => inflight.delete(path));
  inflight.set(path, request);
  return request;
}

/** Warm the cache (e.g. on menu hover) unless the path is already cached or loading. */
export function prefetch(...paths: string[]) {
  for (const path of paths) {
    if (!store.has(path) && !inflight.has(path)) load(path).catch(() => {});
  }
}

/**
 * Returns `undefined` until the first response arrives (render a skeleton then).
 * On failure without cached data it settles on `fallback`.
 */
export function useCached<T>(path: string, fallback?: T) {
  const [data, setData] = useState<T | undefined>(() => store.get(path) as T | undefined);
  useEffect(() => {
    let live = true;
    setData(store.get(path) as T | undefined);
    load<T>(path)
      .then((value) => {
        if (live) setData(value);
      })
      .catch(() => {
        if (live && !store.has(path)) setData(fallback);
      });
    return () => {
      live = false;
    };
  }, [path]); // fallback is a constant default; refetch only when the path changes
  const update = useCallback(
    (change: (current: T) => T) =>
      setData((current) => {
        if (current === undefined) return current;
        const next = change(current);
        store.set(path, next);
        return next;
      }),
    [path],
  );
  return [data, update] as const;
}
