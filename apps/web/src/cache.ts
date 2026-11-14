import { useCallback, useEffect, useState } from "react";
import { api } from "@kinora/client";

/**
 * Stale-while-revalidate for GET endpoints: a page shows the last response it saw immediately,
 * then refreshes it in the background. Requests for the same path share one fetch.
 */
const store = new Map<string, unknown>();
const inflight = new Map<string, Promise<unknown>>();
/** Mounted hooks per path, told when a refresh brings new data. */
const listeners = new Map<string, Set<(value: unknown) => void>>();

function load<T>(path: string): Promise<T> {
  const pending = inflight.get(path);
  if (pending) return pending as Promise<T>;
  const request = api<T>(path)
    .then((data) => {
      store.set(path, data);
      for (const listener of listeners.get(path) ?? []) listener(data);
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
 * After a change on the server: drops what is cached under these paths (or path prefixes ending in "/")
 * and reloads the ones a page is showing now.
 */
export function refresh(...paths: string[]) {
  const matches = (key: string) => paths.some((path) => (path.endsWith("/") ? key.startsWith(path) : key === path));
  for (const key of [...store.keys()]) {
    if (!matches(key)) continue;
    store.delete(key);
    if (listeners.get(key)?.size) load(key).catch(() => {});
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
    const listener = (value: unknown) => {
      if (live) setData(value as T);
    };
    let set = listeners.get(path);
    if (!set) listeners.set(path, (set = new Set()));
    set.add(listener);
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
      set.delete(listener);
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
