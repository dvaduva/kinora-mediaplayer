import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import type { Locale } from "./format";

export type LocaleValue<C> = { locale: Locale; t: C; toggle: () => void };

/** Builds a locale provider + hook over `copy`, remembering the choice under `storageKey` (default `"ro"`). */
export function createLocale<C>(copy: Record<Locale, C>, storageKey: string) {
  const LocaleContext = createContext<LocaleValue<C> | null>(null);

  function readLocale(): Locale {
    try {
      const value = localStorage.getItem(storageKey);
      if (value === "en" || value === "ro") return value;
    } catch {
      // storage unavailable
    }
    return "ro";
  }

  function LocaleProvider(props: { children: ReactNode }) {
    const [locale, setLocale] = useState<Locale>(readLocale);
    const value = useMemo<LocaleValue<C>>(
      () => ({
        locale,
        t: copy[locale],
        toggle: () =>
          setLocale((current) => {
            const next = current === "ro" ? "en" : "ro";
            try {
              localStorage.setItem(storageKey, next);
            } catch {
              // storage unavailable
            }
            return next;
          }),
      }),
      [locale],
    );
    return <LocaleContext.Provider value={value}>{props.children}</LocaleContext.Provider>;
  }

  function useLocale(): LocaleValue<C> {
    const value = useContext(LocaleContext);
    if (!value) throw new Error("LocaleProvider missing");
    return value;
  }

  return { LocaleProvider, useLocale };
}
