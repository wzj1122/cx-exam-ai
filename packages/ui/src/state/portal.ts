import { createContext } from 'react';

/** Shadow DOM shells provide their mount node so Radix portals stay inside the shadow root. */
export const PortalContainerContext = createContext<HTMLElement | null>(null);
