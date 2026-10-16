import { createContext, useContext } from 'react';
import type { Circle, CirclePost, Profile } from '../types';
export const CommunityContext = createContext<{
  profile: Profile;
  circles: Circle[];
  revision: number;
  recognition: Record<string, string>;
  hostCircles: Set<string>;
  refresh: () => void;
  open: (kind: 'library' | 'participate' | 'host' | 'invite' | 'chat', circle: Circle) => void;
  collect: (post: CirclePost) => void;
  catchup: () => void;
} | null>(null);
export const useCommunity = () => useContext(CommunityContext);
