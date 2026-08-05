/**
 * The single declarative source of truth for how each setting is presented.
 *
 * Upstream already supplies a name and description per key (`SettingInformation`
 * in commonlib) and already knows which keys must agree between devices
 * (`TweakValuesShouldMatchedTemplate`). What has never existed is a statement of
 * *how important each setting is to a working user*, so every pane invented its
 * own visibility rule and the result was 167 keys spread across 24 panes gated
 * by four ad-hoc mode booleans.
 *
 * This module supplies exactly that missing axis, and nothing else:
 *
 * - `tier`     — basic, advanced, or expert. Replaces `useAdvancedMode`,
 *                `usePowerUserMode`, `useEdgeCaseMode` and `enableDebugTools`.
 * - `section`  — which group a setting belongs to, in reading order.
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

export interface SettingSection {
    readonly id: string;
    /** Sentence case, per the design principles. */
    readonly title: string;
    /** One line explaining what the group is for. Shown under the title. */
    readonly summary: string;
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
        id: "device",
        title: "This device",
        summary: "How this device identifies itself to the others.",
        tier: TIER_BASIC,
        // Required before Customisation Sync will activate at all, and the
        // single most common reason it silently does nothing.
        keys: ["deviceAndVaultName"],
    },
    {
        id: "when",
        title: "When to sync",
        summary: "How eagerly changes are exchanged with the server.",
        tier: TIER_BASIC,
        // Upstream already collapses the eight trigger booleans into this one
        // pseudo-setting. The booleans themselves are expert-tier below.
        keys: ["syncMinimumInterval"],
    },
    {
        id: "what",
        title: "What to sync",
        summary: "Which files are included, and which are left alone.",
        tier: TIER_BASIC,
        keys: ["syncMaxSizeInMB", "useIgnoreFiles", "ignoreFiles", "syncInternalFiles", "usePluginSync"],
    },
    {
        id: "privacy",
        title: "Privacy",
        summary: "End-to-end encryption of vault contents at rest on the server.",
        tier: TIER_BASIC,
        keys: ["encrypt", "passphrase"],
    },
];

const ADVANCED_SECTIONS: readonly SettingSection[] = [
    {
        id: "triggers",
        title: "Sync triggers",
        summary: "Exactly which events start a replication.",
        tier: TIER_ADVANCED,
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
        id: "conflicts",
        title: "Conflicts",
        summary: "What happens when the same file changes in two places.",
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
        id: "selection",
        title: "File selection",
        summary: "Finer control over which paths take part.",
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
        title: "Deletion",
        summary: "How removals propagate between devices.",
        tier: TIER_ADVANCED,
        keys: ["trashInsteadDelete", "doNotDeleteFolder", "deleteMetadataOfDeletedFiles"],
    },
    {
        id: "appearance",
        title: "Appearance",
        summary: "What the plugin shows you, and when.",
        tier: TIER_ADVANCED,
        keys: ["displayLanguage", "showStatusOnStatusbar", "showStatusOnEditor", "hideFileWarningNotice"],
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
    return TIERS.indexOf(tierOf(key)) <= TIERS.indexOf(viewing);
}

/** Sections to render at the given tier, in declaration order. */
export function sectionsForTier(viewing: SettingTier): readonly SettingSection[] {
    const limit = TIERS.indexOf(viewing);
    return SETTING_SECTIONS.filter((section) => TIERS.indexOf(section.tier) <= limit);
}

/** Every key named by the catalogue. Used to prove it against the real schema. */
export function cataloguedKeys(): readonly SettingKey[] {
    return [...EXPLICIT_TIERS.keys()];
}
