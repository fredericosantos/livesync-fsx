/**
 * The single declarative source of truth for how the settings page is organised.
 *
 * Upstream already supplies a name and description per key (`SettingInformation`
 * in commonlib) and already knows which keys must agree between devices
 * (`TweakValuesShouldMatchedTemplate`). What has never existed is a statement of
 * *what a working user is shown*, so every pane invented its own visibility rule
 * and the result was 167 keys across 12 panes, ordered by magic numbers and
 * gated by four independent mode booleans.
 *
 * There is now no tier and no mode. The settings page shows what a working vault
 * needs; everything else is a tool, and tools live behind one button.
 *
 * Deliberately *not* here: labels, descriptions, defaults, or the must-match
 * set. Those already exist upstream and duplicating them would guarantee drift.
 */

import type { ObsidianLiveSyncSettings } from "@vrtmrz/livesync-commonlib/settings";

export type SettingKey = keyof ObsidianLiveSyncSettings;

export interface SettingPaneDefinition {
    /**
     * Stable identifier. Replaces the magic ordering numbers, which encoded
     * position and identity in the same value and so could not be reordered.
     */
    readonly id: string;
    readonly title: string;
    /**
     * Panes that only make sense once there is a working connection, or only
     * before there is one. Omitted means "always".
     */
    readonly requires?: "configured" | "unconfigured";
}

/**
 * The settings page, in reading order. Setup first because it is where a new
 * vault starts and where a broken one is repaired.
 */
export const SETTING_PANES: readonly SettingPaneDefinition[] = [
    { id: "setup", title: "Setup" },
    { id: "sync", title: "Sync" },
    { id: "files", title: "Files", requires: "configured" },
    { id: "plugins", title: "Plugins", requires: "configured" },
    { id: "appearance", title: "Appearance" },
];

/**
 * Not settings. Rebuilding a database, reading a log and applying a patch are
 * things you *do*, occasionally, usually because something is wrong. They open
 * from one row at the foot of the settings page rather than living on it.
 */
export const TOOL_PANES: readonly SettingPaneDefinition[] = [
    { id: "maintenance", title: "Maintenance" },
    { id: "diagnostics", title: "Diagnostics" },
    { id: "tuning", title: "Performance" },
    { id: "patches", title: "Patches" },
];

export function panesFor(isConfigured: boolean): readonly SettingPaneDefinition[] {
    return SETTING_PANES.filter((pane) => {
        if (pane.requires === "configured") return isConfigured;
        if (pane.requires === "unconfigured") return !isConfigured;
        return true;
    });
}

export interface SettingSection {
    readonly id: string;
    /** Which pane it appears in. */
    readonly pane: string;
    /**
     * Sentence case, per the design principles. Empty means no heading at all:
     * a group of obvious controls does not need to be told what it is.
     */
    readonly title: string;
    readonly keys: readonly SettingKey[];
}

/**
 * Everything a working user needs, and nothing else.
 *
 * The test for inclusion is deliberately harsh: would a competent user with a
 * working setup ever need to change this? If the honest answer is "only when
 * something has gone wrong", it does not belong on the settings page.
 */
export const SETTING_SECTIONS: readonly SettingSection[] = [
    {
        id: "basics",
        pane: "sync",
        // No heading. The page is the plugin's settings and the section is
        // sync; naming the group again only repeats what the reader can see.
        title: "",
        // `deviceAndVaultName` is required before Customisation Sync will
        // activate at all, and the single most common reason it silently does
        // nothing — so it leads.
        keys: ["deviceAndVaultName", "syncInternalFiles", "usePluginSync"],
    },
    {
        id: "privacy",
        pane: "sync",
        // The one heading that carries information rather than repeating it:
        // this is a decision with consequences on every other device, not a
        // preference sitting among preferences.
        title: "End-to-end encryption",
        keys: ["encrypt", "passphrase"],
    },
    {
        id: "ignore-rules",
        pane: "files",
        title: "",
        keys: ["useIgnoreFiles", "ignoreFiles"],
    },
    {
        id: "selection",
        pane: "files",
        title: "Paths",
        keys: ["syncOnlyRegEx", "syncIgnoreRegEx", "syncInternalFilesIgnorePatterns", "syncInternalFilesTargetPatterns"],
    },
    {
        id: "visibility",
        pane: "appearance",
        title: "",
        keys: ["showStatusOnStatusbar", "showStatusOnEditor", "showOnlyIconsOnEditor", "hideFileWarningNotice"],
    },
];

const SECTION_KEYS = new Set<SettingKey>(SETTING_SECTIONS.flatMap((section) => [...section.keys]));

/** Sections of one pane, in declaration order. */
export function sectionsForPane(pane: string): readonly SettingSection[] {
    return SETTING_SECTIONS.filter((section) => section.pane === pane);
}

/** Every key the settings page shows. Used to prove it against the real schema. */
export function cataloguedKeys(): readonly SettingKey[] {
    return [...SECTION_KEYS];
}
