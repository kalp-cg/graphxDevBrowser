import { useEffect, useState } from 'react';

/** Below this window width a tool panel takes the whole content area instead of sharing it with the page. */
export const NARROW_PX = 900;

/** Views that are a place of their own (like chrome://settings), not a tool docked beside the page. */
export const FULL_PAGE_VIEWS: ReadonlySet<string> = new Set(['dependencies', 'settings']);

export function useNarrow(): boolean {
  const [narrow, setNarrow] = useState(() => window.innerWidth < NARROW_PX);
  useEffect(() => {
    const onResize = () => setNarrow(window.innerWidth < NARROW_PX);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  return narrow;
}
