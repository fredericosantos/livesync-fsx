/**
 * The single declarative source of truth for the settings page.
 *
 * The page is a flat list of groups. One entry here is exactly one Obsidian
 * `SettingGroup`: a heading, and a card containing its items. Nothing else
 * decides what appears, in what order, or under which heading — so a heading
 * cannot be duplicated by a pane and a panel both claiming it, and spacing
 * cannot differ between two groups because one happened to start a "pane".
 *
 * Deliberately *not* here: labels, descriptions, defaults, or the must-match
 * set. Those already exist upstream and duplicating them would guarantee drift.
 * Copy we deliberately override lives in `sectionCopy` in `renderSection.ts`.
 */

import type { ObsidianLiveSyncSettings } from "@vrtmrz/livesync-commonlib/settings";

export type SettingKey = keyof ObsidianLiveSyncSettings;

export interface SettingSection {
    /**
     * Stable identifier. Replaces the magic ordering numbers, which encoded
     * position and identity in the same value and so could not be reordered.
     */
    readonly id: string;
    /**
     * Sentence case. Empty means no heading at all: a group of obvious
     * controls does not need to be told what it is.
     */
    readonly title: string;
    /**
     * Groups that only make sense once there is a working connection, or only
     * before there is one. Omitted means "always".
     */
    readonly requires?: "configured" | "unconfigured";
    /** Shown only while another setting holds this value. */
    readonly shownWhen?: { readonly key: SettingKey; readonly is: unknown };
    /** Settings, in reading order. Rendered from the schema; see `renderSection`. */
    readonly keys: readonly SettingKey[];
    /**
     * Identifier of an extra renderer appended after the keys, for the things
     * that are actions rather than settings (connect, discard, open a dialog).
     */
    readonly extra?: string;
}

/**
 * Everything a working user needs, and nothing else.
 *
 * The test for inclusion is deliberately harsh: would a competent user with a
 * working setup ever need to change this? If the honest answer is "only when
 * something has gone wrong", it does not belong on the settings page — it
 * belongs in the command palette, or nowhere.
 */
export const SETTING_SECTIONS: readonly SettingSection[] = [
    {
        // An unconfigured vault has exactly one decision, so it gets exactly
        // one row and no heading above it.
        id: "connect",
        title: "",
        requires: "unconfigured",
        keys: [],
        extra: "connect",
    },
    {
        id: "server",
        title: "",
        requires: "configured",
        keys: [],
        extra: "server",
    },
    {
        id: "sync",
        title: "Sync",
        // `deviceAndVaultName` is required before Customisation Sync will
        // activate at all, and the single most common reason it silently does
        // nothing — so it leads.
        keys: ["deviceAndVaultName", "syncInternalFiles", "usePluginSync"],
        extra: "plugin-sync-dialog",
    },
    {
        // The one heading that carries information rather than repeating it:
        // this is a decision with consequences on every other device, not a
        // preference sitting among preferences.
        id: "encryption",
        title: "End-to-end encryption",
        keys: ["encrypt", "passphrase"],
    },
    {
        id: "files",
        title: "Files",
        requires: "configured",
        keys: ["useIgnoreFiles", "ignoreFiles", "syncOnlyRegEx", "syncIgnoreRegEx"],
    },
    {
        // Only reachable when hidden-file sync is on; otherwise the patterns
        // govern nothing.
        id: "hidden-files",
        title: "Hidden files",
        requires: "configured",
        shownWhen: { key: "syncInternalFiles", is: true },
        keys: ["syncInternalFilesTargetPatterns", "syncInternalFilesIgnorePatterns"],
    },
    // No "Appearance". Every setting that was there asked the reader to
    // configure the plugin's own chrome: which language it speaks (there is
    // one), whether the status appears in the editor as well as the status
    // bar, and whether that status is icons or words. Obsidian's own Sync
    // answers all of it with a single status-bar icon and no question, which
    // is the right answer here too. The defaults are in `PREFERRED_BASE`.
    {
        // Last, so a destructive action is never above an ordinary one.
        id: "discard",
        title: "",
        requires: "configured",
        keys: [],
        extra: "discard",
    },
];

/** The page, in reading order, for the current connection state. */
export function sectionsFor(isConfigured: boolean): readonly SettingSection[] {
    return SETTING_SECTIONS.filter((section) => {
        if (section.requires === "configured") return isConfigured;
        if (section.requires === "unconfigured") return !isConfigured;
        return true;
    });
}

/** Every key the settings page shows. Used to prove it against the real schema. */
export function cataloguedKeys(): readonly SettingKey[] {
    return [...new Set(SETTING_SECTIONS.flatMap((section) => [...section.keys]))];
}
