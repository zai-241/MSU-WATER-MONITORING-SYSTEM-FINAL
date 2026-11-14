import { useSyncExternalStore } from 'react';

/** True while the CSS media query matches. False where matchMedia is unavailable. */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      if (typeof window === 'undefined' || !window.matchMedia) return () => {};
      const mql = window.matchMedia(query);
      mql.addEventListener?.('change', onChange);
      return () => mql.removeEventListener?.('change', onChange);
    },
    () => (typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(query).matches : false),
    () => false,
  );
}

/** Phones in portrait and small landscape: below Tailwind's sm breakpoint (640px). */
export const useIsPhone = () => useMediaQuery('(max-width: 639px)');
