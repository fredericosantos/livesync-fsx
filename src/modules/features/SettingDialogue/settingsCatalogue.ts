/**
 * The single declarative source of truth for how the settings dialogue is
 * organised: which panes exist, in what order, and how much of each is shown.
 *
 * Upstream already supplies a name and description per key (`SettingInformation`
 * in commonlib) and already knows which keys must agree between devices
 * (`TweakValuesShouldMatchedTemplate`). What has never existed is a statement of
 * *how important each thing is to a working user*, so every pane invented its
 * own visibility rule and the result was 167 keys across 12 panes, ordered by
 * magic numbers (0, 20, 30, 33, 46, 47, 50, 51, 60, 70, 100, 110) and gated by
 * four independent mode booleans.
 *
 * This module supplies exactly that missing axis, and nothing else.
 *
 * Deliberately *not* here: labels, descriptions, defaults, or the must-match
 * set. Those already exist upstream and duplicating them would guarantee drift.
 *
 * See `docs/fork/01-design-principles.md` (principle 6, progressive disclosure).
 */

import type { ObsidianLiveSyncSettings } from "@vrtmrz/livesync-commonlib/settings";

export const TIER_BASIC = "basic";
export const TIER_ADVANCED = "advanced";
export const TIER_EXPERT = "expert";

/** Ascending order of the amount of trouble a user can get into. */
export const TIERS = [TIER_BASIC, TIER_ADVANCED, TIER_EXPERT] as const;
export type SettingTier = (typeof TIERS)[number];

export type SettingKey = keyof ObsidianLiveSyncSettings;

export function isAtLeast(viewing: SettingTier, required: SettingTier): boolean {
    return TIERS.indexOf(viewing) >= TIERS.indexOf(required);
}

// --- Tier as a single control, backed by the settings that already exist -----

/**
 * The tier is not a new stored setting. It is derived from the three mode
 * booleans upstream already persists, so existing vaults keep working and
 * nothing has to be migrated. One control writes all three.
 */
export interface ModeFlags {
    useAdvancedMode: boolean;
    usePowerUserMode: boolean;
    useEdgeCaseMode: boolean;
}

export function tierFromModeFlags(flags: Readonly<ModeFlags>): SettingTier {
    if (flags.usePowerUserMode || flags.useEdgeCaseMode) return TIER_EXPERT;
    if (flags.useAdvancedMode) return TIER_ADVANCED;
    return TIER_BASIC;
}

export function modeFlagsForTier(tier: SettingTier): ModeFlags {
    return {
        useAdvancedMode: isAtLeast(tier, TIER_ADVANCED),
        usePowerUserMode: isAtLeast(tier, TIER_EXPERT),
        useEdgeCaseMode: isAtLeast(tier, TIER_EXPERT),
    };
}

export const TIER_LABELS: Readonly<Record<SettingTier, string>> = {
    [TIER_BASIC]: "Simple",
    [TIER_ADVANCED]: "Advanced",
    [TIER_EXPERT]: "Everything",
};

export const TIER_DESCRIPTIONS: Readonly<Record<SettingTier, string>> = {
    [TIER_BASIC]: "Just enough for a working vault.",
    [TIER_ADVANCED]: "Adds conflict handling, file selection, and appearance.",
    [TIER_EXPERT]: "Every setting, including ones that can break replication.",
};

// --- Panes -----------------------------------------------------------------

export interface SettingPaneDefinition {
    /**
     * Stable identifier. Replaces the magic ordering numbers, which encoded
     * position and identity in the same value and so could not be reordered.
     */
    readonly id: string;
    readonly title: string;
    /** Lucide icon name, resolved through Obsidian's `setIcon`. */
    readonly icon: string;
    readonly tier: SettingTier;
    /**
     * Panes that only make sense once there is a working connection, or only
     * before there is one. Omitted means "always".
     */
    readonly requires?: "configured" | "unconfigured";
}

/**
 * Reading order, not importance order. Setup comes first because it is where a
 * new vault starts and where a broken one is repaired; Sync is what a working
 * user opens; everything after that is occasional.
 */
export const SETTING_PANES: readonly SettingPaneDefinition[] = [
    { id: "setup", title: "Setup", icon: "wand", tier: TIER_BASIC },
    { id: "sync", title: "Sync", icon: "refresh-cw", tier: TIER_BASIC },
    { id: "server", title: "Server", icon: "server", tier: TIER_ADVANCED },
    { id: "files", title: "Files", icon: "filter", tier: TIER_ADVANCED },
    { id: "plugins", title: "Plugins", icon: "blocks", tier: TIER_ADVANCED },
    { id: "appearance", title: "Appearance", icon: "settings", tier: TIER_ADVANCED },
    { id: "maintenance", title: "Maintenance", icon: "hard-drive", tier: TIER_ADVANCED },
    { id: "diagnostics", title: "Diagnostics", icon: "activity", tier: TIER_EXPERT },
    { id: "tuning", title: "Tuning", icon: "sliders-horizontal", tier: TIER_EXPERT },
    { id: "patches", title: "Patches", icon: "bandage", tier: TIER_EXPERT },
];

export function panesForTier(viewing: SettingTier, isConfigured: boolean): readonly SettingPaneDefinition[] {
    return SETTING_PANES.filter((pane) => {
        if (!isAtLeast(viewing, pane.tier)) return false;
        if (pane.requires === "configured") return isConfigured;
        if (pane.requires === "unconfigured") return !isConfigured;
        return true;
    });
}

// --- Sections --------------------------------------------------------------

export interface SettingSection {
    readonly id: string;
    /** Which pane it appears in. */
    readonly pane: string;
    /**
     * Sentence case, per the design principles. Empty means no heading at all:
     * a single obvious control does not need to be told what it is.
     */
    readonly title: string;
    readonly tier: SettingTier;
    readonly keys: readonly SettingKey[];
}

/**
 * Everything a working user needs, and nothing else.
 *
 * The test for inclusion is deliberately harsh: would a competent user with a
 * working setup ever need to change this? If the honest answer is "only when
 * something has gone wrong", it is not basic.
 */
const BASIC_SECTIONS: readonly SettingSection[] = [
    {
        id: "basics",
        pane: "sync",
        // No heading. The page is the plugin's settings and the section is
        // sync; naming the group again only repeats what the reader can see.
        title: "",
        tier: TIER_BASIC,
        // `deviceAndVaultName` is required before Customisation Sync will
        // activate at all, and the single most common reason it silently does
        // nothing — so it leads.
        keys: ["deviceAndVaultName", "syncInternalFiles", "usePluginSync"],
    },
    {
        id: "privacy",
        pane: "sync",
        title: "End-to-end encryption",
        // "At rest on the server" is how a security engineer says it, not how
        // anyone else does. What the user needs to know is who can read the
        // files if the server is taken.
        tier: TIER_BASIC,
        keys: ["encrypt", "passphrase"],
    },
];

const ADVANCED_SECTIONS: readonly SettingSection[] = [
    {
        id: "conflicts",
        pane: "sync",
        title: "Conflicts",
        tier: TIER_ADVANCED,
        keys: [
            "resolveConflictsByNewerFile",
            "checkConflictOnlyOnOpen",
            "showMergeDialogOnlyOnActive",
            "disableMarkdownAutoMerge",
            "writeDocumentsIfConflicted",
        ],
    },
    {
        id: "when",
        pane: "sync",
        title: "When to sync",
        tier: TIER_ADVANCED,
        // `preset` is upstream's existing pseudo-setting that writes all eight
        // trigger booleans at once. `syncMaxSizeInMB` lives here rather than in
        // "What to sync" because it silently skips files; it is a performance
        // valve, not a selection rule, and it defaults to off.
        keys: ["preset" as SettingKey, "syncMinimumInterval", "syncMaxSizeInMB"],
    },
    {
        id: "triggers",
        pane: "sync",
        title: "Individual sync triggers",
        tier: TIER_EXPERT,
        keys: [
            "liveSync",
            "periodicReplication",
            "periodicReplicationInterval",
            "syncOnSave",
            "syncOnEditorSave",
            "syncOnStart",
            "syncOnFileOpen",
            "syncAfterMerge",
            "keepReplicationActiveInBackground",
        ],
    },
    {
        id: "ignore-rules",
        pane: "files",
        title: "Ignore rules",
        tier: TIER_ADVANCED,
        keys: ["useIgnoreFiles", "ignoreFiles"],
    },
    {
        id: "selection",
        pane: "files",
        title: "File selection",
        tier: TIER_ADVANCED,
        keys: [
            "syncOnlyRegEx",
            "syncIgnoreRegEx",
            "syncInternalFilesIgnorePatterns",
            "syncInternalFilesTargetPatterns",
            "usePathObfuscation",
        ],
    },
    {
        id: "deletion",
        pane: "files",
        title: "Deletion",
        tier: TIER_ADVANCED,
        keys: ["trashInsteadDelete", "doNotDeleteFolder", "deleteMetadataOfDeletedFiles"],
    },
    {
        id: "visibility",
        pane: "appearance",
        title: "What you are shown",
        tier: TIER_ADVANCED,
        keys: ["showStatusOnStatusbar", "showStatusOnEditor", "showOnlyIconsOnEditor", "hideFileWarningNotice"],
    },
    {
        id: "logging",
        pane: "appearance",
        title: "Logging",
        tier: TIER_EXPERT,
        keys: ["lessInformationInLog", "showVerboseLog", "writeLogToTheFile"],
    },
];

export const SETTING_SECTIONS: readonly SettingSection[] = [...BASIC_SECTIONS, ...ADVANCED_SECTIONS];

/**
 * Explicit tier assignments, derived from the sections above.
 * Any key not named here is expert: reachable, but never in the way.
 */
const EXPLICIT_TIERS = new Map<SettingKey, SettingTier>(
    SETTING_SECTIONS.flatMap((section) => section.keys.map((key) => [key, section.tier] as const))
);

export function tierOf(key: SettingKey): SettingTier {
    return EXPLICIT_TIERS.get(key) ?? TIER_EXPERT;
}

export function isVisibleAtTier(key: SettingKey, viewing: SettingTier): boolean {
    return isAtLeast(viewing, tierOf(key));
}

/** Sections of one pane to render at the given tier, in declaration order. */
export function sectionsForPane(pane: string, viewing: SettingTier): readonly SettingSection[] {
    return SETTING_SECTIONS.filter((section) => section.pane === pane && isAtLeast(viewing, section.tier));
}

/** Every key named by the catalogue. Used to prove it against the real schema. */
export function cataloguedKeys(): readonly SettingKey[] {
    return [...EXPLICIT_TIERS.keys()];
}
