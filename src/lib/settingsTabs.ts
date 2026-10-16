/**
 * Settings tab resolution (F35).
 *
 * src/App.tsx gives five tabs a route of their own (/dashboard/settings/<key>).
 * Integrations and Personal automation have no route; they ride on the base
 * route as /dashboard/settings?tab=<key>, which already carries ?recovery= and
 * ?force_password_change= for the Account tab, so no routing change was needed
 * to give them a destination. A path tab wins over the query string, an
 * unknown ?tab= value is ignored, and anything else is the Account tab. Hrefs
 * are built here too, so the nav and the resolver cannot disagree about where
 * a tab lives.
 */

export type SettingMode = "profile" | "agency" | "notifications" | "security" | "integrations" | "automation" | "billing" | "nova-pro";

export const SETTINGS_BASE_PATH = "/dashboard/settings";
export const SETTINGS_TAB_PARAM = "tab";

/** Tabs declared as their own <Route> in src/App.tsx. */
export const PATH_SETTING_MODES: readonly SettingMode[] = ["agency", "notifications", "security", "billing", "nova-pro"];

/** Tabs served by the base route through ?tab=<key>. */
export const QUERY_SETTING_MODES: readonly SettingMode[] = ["integrations", "automation"];

/** Agency (white-label branding, subdomain) and Billing are owner-level controls. */
export const ADMIN_SETTING_MODES: readonly SettingMode[] = ["agency", "billing"];

/** Tab label (nav) and page title (header and document title) for each tab. */
export const SETTINGS_TABS: Record<SettingMode, { label: string; title: string }> = {
  profile: { label: "Account", title: "Account settings" },
  agency: { label: "Agency", title: "Agency settings" },
  notifications: { label: "Notifications", title: "Notifications settings" },
  security: { label: "Security", title: "Security settings" },
  integrations: { label: "Integrations", title: "Integrations" },
  automation: { label: "Personal automation", title: "Personal automation" },
  billing: { label: "Billing", title: "Billing settings" },
  "nova-pro": { label: "Assistant", title: "AI assistant" },
};

/** Where a tab lives: its own route, or the base route with ?tab=<key>. */
export function settingsTabHref(mode: SettingMode): string {
  if (mode === "profile") return SETTINGS_BASE_PATH;
  if (QUERY_SETTING_MODES.includes(mode)) return `${SETTINGS_BASE_PATH}?${SETTINGS_TAB_PARAM}=${mode}`;
  return `${SETTINGS_BASE_PATH}/${mode}`;
}

/** The tab a location names. Path tabs first, then ?tab= on the base route, else Account. */
export function resolveSettingMode(pathname: string, search: string): SettingMode {
  const path = pathname.replace(/\/+$/, "");
  const byPath = PATH_SETTING_MODES.find((key) => path.endsWith(`/${key}`));
  if (byPath) return byPath;
  const tab = new URLSearchParams(search).get(SETTINGS_TAB_PARAM);
  return QUERY_SETTING_MODES.find((key) => key === tab) ?? "profile";
}
