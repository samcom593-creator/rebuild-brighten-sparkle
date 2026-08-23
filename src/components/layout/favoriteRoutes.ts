import { create } from "zustand";
import { agentCloudBreadcrumb } from "./agentCloudNavigation";

/**
 * favoriteRoutes — backing store for the TopBar star control.
 *
 * Why this exists: the star in TopBar shipped with no onClick handler. It
 * rendered, it had an aria-label ("Favorite page"), it had a hover state — and
 * clicking it did nothing at all. A control that looks live and is inert is
 * indistinguishable from a broken one to the person using it, so the star now
 * writes to real persisted state that the sidebar reads back.
 *
 * Storage is localStorage, not the database, on purpose: a pinned route is a
 * per-browser convenience, it carries no business truth, and putting it in
 * Postgres would mean a network round-trip on every dashboard paint for
 * something the user can rebuild in two clicks.
 */

export interface FavoriteRoute {
  href: string;
  label: string;
}

const STORAGE_KEY = "apex:favorites:v1";
const MAX_FAVORITES = 8;

function readStored(): FavoriteRoute[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // Defensive: a hand-edited or half-written value must not crash the shell.
    return parsed
      .filter((entry): entry is FavoriteRoute =>
        !!entry && typeof entry.href === "string" && typeof entry.label === "string")
      .slice(0, MAX_FAVORITES);
  } catch { // empty-catch-allow:jsonparse-fallback
    return [];
  }
}

function persist(favorites: FavoriteRoute[]) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(favorites));
  } catch { // empty-catch-allow:localstorage-incognito
    /* private mode / quota — the in-memory list still works this session */
  }
}

/** Human label for a route, reusing the breadcrumb map the TopBar already renders. */
export function favoriteLabelFor(pathname: string): string {
  const crumbs = agentCloudBreadcrumb(pathname);
  return crumbs[crumbs.length - 1] || "Home";
}

interface FavoriteRoutesState {
  favorites: FavoriteRoute[];
  isFavorite: (href: string) => boolean;
  toggleFavorite: (href: string, label: string) => void;
}

export const useFavoriteRoutes = create<FavoriteRoutesState>((set, get) => ({
  favorites: readStored(),
  isFavorite: (href) => get().favorites.some((entry) => entry.href === href),
  toggleFavorite: (href, label) => set((state) => {
    const exists = state.favorites.some((entry) => entry.href === href);
    const favorites = exists
      ? state.favorites.filter((entry) => entry.href !== href)
      : [...state.favorites, { href, label }].slice(-MAX_FAVORITES);
    persist(favorites);
    return { favorites };
  }),
}));
