import { useEffect, useState } from 'react';

/**
 * Reactive viewport match. Components (Sidebar / RightRail) use this to
 * avoid mounting — and fetching — below their desktop breakpoint, so
 * mobile pays zero cost for rails it never sees.
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState<boolean>(
    () => typeof window !== 'undefined' && window.matchMedia(query).matches
  );

  useEffect(() => {
    const mql = window.matchMedia(query);
    const onChange = (event: MediaQueryListEvent) => setMatches(event.matches);
    setMatches(mql.matches);
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, [query]);

  return matches;
}
