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
        // Obsidian's own Sync names these categories, in these words, and a
        // reader who has seen that screen should recognise this one. What is
        // added beyond it is the plug-in table: Obsidian has a single switch
        // for all community plug-ins, so a plug-in wanted only on the desktop
        // costs you the whole category.
        //
        // This replaced Customisation Sync, which stored one document *per
        // device* and asked the reader to choose whose copy to apply, per item,
        // by hand, in a pane of its own. That is a manual transfer with a
        // filing system, not synchronisation, and it obliged a second mechanism
        // to exist inside Hidden File Sync purely to keep the two from fighting
        // over the same file.
        //
        // The switch that governs all of this is inside the group rather than
        // in one of its own above it. It was a separate card headed "Sync", so
        // the card that appeared when it was turned on had no visible relation
        // to the thing that turned it on — a heading, a switch, and then a
        // second heading with everything the switch controls.
        id: "config-categories",
        title: "App settings and plugins",
        requires: "configured",
        // The eight category settings are rendered as five rows; see
        // `controls/ConfigCategories.ts` for why the pairs are not separable.
        keys: [],
        extra: "config-categories",
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
        id: "server-storage",
        title: "Server storage",
        requires: "configured",
        // The remote-capacity warning used to be here, and before that a
        // start-up popup offering four sizes. It has been set to never warn
        // since the popup went, and a switch nobody has turned on in the
        // meantime is a switch that can go.
        keys: [],
        extra: "file-size-limit",
    },
    {
        // One way to exclude a file, not three. There used to be, in addition
        // to the ignore files below, a pair of regular-expression lists for
        // ordinary files and a second pair for hidden ones — four lists, all
        // kept in the plug-in's settings rather than in the Vault, all able to
        // express the same thing, and none of them visible to the other
        // devices they silently governed.
        //
        // An ignore file wins on every count that matters: it is a format the
        // reader already knows, it sits next to the files it excludes, it
        // supports negation and nesting, and it synchronises with the Vault, so
        // one device's exclusions are every device's exclusions. The hidden-file
        // patterns keep working, but as constants rather than questions: their
        // defaults exclude `node_modules`, `.git` and the plug-in's own folder,
        // which is the whole of what anyone ever needed them for.
        id: "files",
        title: "Files",
        requires: "configured",
        keys: ["useIgnoreFiles", "ignoreFiles"],
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
