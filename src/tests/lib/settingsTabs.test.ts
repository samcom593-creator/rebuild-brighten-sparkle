/**
 * F35: Integrations and Personal automation are real destinations. The two
 * tabs ride on the base settings route as ?tab=<key>; the nav builds hrefs
 * from the same module that resolves them, and the path tabs are pinned to
 * the routes src/App.tsx declares.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  ADMIN_SETTING_MODES,
  PATH_SETTING_MODES,
  QUERY_SETTING_MODES,
  SETTINGS_BASE_PATH,
  SETTINGS_TABS,
  resolveSettingMode,
  settingsTabHref,
  type SettingMode,
} from "@/lib/settingsTabs";

const ALL_MODES = Object.keys(SETTINGS_TABS) as SettingMode[];
const appSource = fs.readFileSync(path.resolve(__dirname, "../../App.tsx"), "utf8");

describe("resolveSettingMode", () => {
  it("reads path tabs from the pathname, with or without a trailing slash", () => {
    expect(resolveSettingMode("/dashboard/settings/security", "")).toBe("security");
    expect(resolveSettingMode("/dashboard/settings/nova-pro/", "")).toBe("nova-pro");
    expect(resolveSettingMode("/dashboard/settings/agency", "?recovery=true")).toBe("agency");
  });

  it("reads the query tabs from ?tab= on the base route", () => {
    expect(resolveSettingMode(SETTINGS_BASE_PATH, "?tab=integrations")).toBe("integrations");
    expect(resolveSettingMode(SETTINGS_BASE_PATH, "?tab=automation")).toBe("automation");
    expect(resolveSettingMode(SETTINGS_BASE_PATH, "?recovery=true&tab=automation")).toBe("automation");
  });

  it("lands on Account for the base route, an unknown tab, and the existing auth flows", () => {
    expect(resolveSettingMode(SETTINGS_BASE_PATH, "")).toBe("profile");
    expect(resolveSettingMode(SETTINGS_BASE_PATH, "?tab=nope")).toBe("profile");
    expect(resolveSettingMode(SETTINGS_BASE_PATH, "?tab=agency")).toBe("profile");
    expect(resolveSettingMode(SETTINGS_BASE_PATH, "?recovery=true")).toBe("profile");
    expect(resolveSettingMode(SETTINGS_BASE_PATH, "?force_password_change=true")).toBe("profile");
  });

  it("lets a path tab win over a stray ?tab=", () => {
    expect(resolveSettingMode("/dashboard/settings/security", "?tab=integrations")).toBe("security");
  });
});

describe("settingsTabHref", () => {
  it("round-trips every tab through the resolver, so the nav cannot point where the resolver does not go", () => {
    for (const mode of ALL_MODES) {
      const href = settingsTabHref(mode);
      const [pathname, query = ""] = href.split("?");
      expect(resolveSettingMode(pathname, query ? `?${query}` : "")).toBe(mode);
    }
  });

  it("keeps the base path for the query tabs and uses the declared route for the path tabs", () => {
    for (const mode of QUERY_SETTING_MODES) expect(settingsTabHref(mode)).toBe(`${SETTINGS_BASE_PATH}?tab=${mode}`);
    for (const mode of PATH_SETTING_MODES) expect(settingsTabHref(mode)).toBe(`${SETTINGS_BASE_PATH}/${mode}`);
    expect(settingsTabHref("profile")).toBe(SETTINGS_BASE_PATH);
  });
});

describe("routes in src/App.tsx", () => {
  it("declares the base route and one route per path tab", () => {
    expect(appSource).toContain(`path="${SETTINGS_BASE_PATH}"`);
    for (const mode of PATH_SETTING_MODES) expect(appSource).toContain(`path="${settingsTabHref(mode)}"`);
  });

  it("declares no route for a query tab; one that gains a route must move to PATH_SETTING_MODES", () => {
    for (const mode of QUERY_SETTING_MODES) expect(appSource).not.toContain(`path="${SETTINGS_BASE_PATH}/${mode}"`);
  });
});

describe("tab tables", () => {
  it("names every mode exactly once across the path, query and Account sets", () => {
    const sorted = [...PATH_SETTING_MODES, ...QUERY_SETTING_MODES, "profile"].sort();
    expect(sorted).toEqual([...ALL_MODES].sort());
  });

  it("keeps the owner-only set inside the known modes with a label and title each", () => {
    for (const mode of ADMIN_SETTING_MODES) expect(ALL_MODES).toContain(mode);
    for (const mode of ALL_MODES) {
      expect(SETTINGS_TABS[mode].label.length).toBeGreaterThan(0);
      expect(SETTINGS_TABS[mode].title.length).toBeGreaterThan(0);
    }
  });
});
