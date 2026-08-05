import { describe, expect, it } from "vitest";
import { SETTINGS_SCHEMA_DEFAULTS } from "@vrtmrz/livesync-commonlib/settings";
import { TweakValuesShouldMatchedTemplate } from "@vrtmrz/livesync-commonlib/compat/common/models/tweak.definition";
import {
    SETTING_SECTIONS,
    TIER_ADVANCED,
    TIER_BASIC,
    TIER_EXPERT,
    cataloguedKeys,
    isVisibleAtTier,
    sectionsForTier,
    tierOf,
    type SettingKey,
} from "./settingsCatalogue.ts";

const schemaKeys = new Set(Object.keys(SETTINGS_SCHEMA_DEFAULTS));

describe("settings catalogue", () => {
    describe("it cannot drift from the real schema", () => {
        it("names only keys that actually exist in ObsidianLiveSyncSettings", () => {
            const unknown = cataloguedKeys().filter((key) => !schemaKeys.has(key));
            expect(unknown, `catalogued keys absent from the settings schema: ${unknown.join(", ")}`).toEqual([]);
        });

        it("never lists the same key in two sections", () => {
            const seen = new Map<SettingKey, string>();
            const duplicates: string[] = [];
            for (const section of SETTING_SECTIONS) {
                for (const key of section.keys) {
                    const previous = seen.get(key);
                    if (previous) duplicates.push(`${key} (${previous} and ${section.id})`);
                    else seen.set(key, section.id);
                }
            }
            expect(duplicates).toEqual([]);
        });

        it("gives every section a stable unique id", () => {
            const ids = SETTING_SECTIONS.map((s) => s.id);
            expect(new Set(ids).size).toBe(ids.length);
        });
    });

    describe("progressive disclosure", () => {
        it("keeps the basic tier genuinely small", () => {
            const basic = cataloguedKeys().filter((key) => tierOf(key) === TIER_BASIC);
            // The whole point is that a working user is not shown 167 switches.
            // If this fails, something was promoted that does not deserve it.
            expect(basic.length).toBeLessThanOrEqual(12);
            expect(basic.length).toBeGreaterThan(0);
        });

        it("defaults anything uncatalogued to expert rather than surfacing it", () => {
            expect(tierOf("hashCacheMaxCount" as SettingKey)).toBe(TIER_EXPERT);
            expect(tierOf("concurrencyOfReadChunksOnline" as SettingKey)).toBe(TIER_EXPERT);
            expect(tierOf("doNotPaceReplication" as SettingKey)).toBe(TIER_EXPERT);
        });

        it("shows lower tiers to higher viewers, never the reverse", () => {
            const basicKey = SETTING_SECTIONS.find((s) => s.tier === TIER_BASIC)!.keys[0];
            const advancedKey = SETTING_SECTIONS.find((s) => s.tier === TIER_ADVANCED)!.keys[0];

            expect(isVisibleAtTier(basicKey, TIER_BASIC)).toBe(true);
            expect(isVisibleAtTier(basicKey, TIER_EXPERT)).toBe(true);
            expect(isVisibleAtTier(advancedKey, TIER_BASIC)).toBe(false);
            expect(isVisibleAtTier(advancedKey, TIER_ADVANCED)).toBe(true);
        });

        it("widens the visible sections monotonically with the tier", () => {
            const basic = sectionsForTier(TIER_BASIC).length;
            const advanced = sectionsForTier(TIER_ADVANCED).length;
            const expert = sectionsForTier(TIER_EXPERT).length;
            expect(basic).toBeGreaterThan(0);
            expect(advanced).toBeGreaterThan(basic);
            expect(expert).toBe(SETTING_SECTIONS.length);
        });

        it("preserves declaration order so the pane reads top to bottom", () => {
            const shown = sectionsForTier(TIER_EXPERT).map((s) => s.id);
            expect(shown).toEqual(SETTING_SECTIONS.map((s) => s.id));
        });
    });

    describe("the mode booleans it replaces are not themselves promoted", () => {
        it("leaves the four ad-hoc mode switches at expert", () => {
            for (const key of ["useAdvancedMode", "usePowerUserMode", "useEdgeCaseMode", "enableDebugTools"]) {
                expect(tierOf(key as SettingKey), key).toBe(TIER_EXPERT);
            }
        });
    });

    describe("dangerous keys stay out of the basic tier", () => {
        it("never puts a must-match tweak in front of a casual user", () => {
            // Changing any of these without changing every other device breaks
            // replication, which is exactly the failure this fork already hit.
            const mustMatch = Object.keys(TweakValuesShouldMatchedTemplate) as SettingKey[];
            const promoted = mustMatch.filter((key) => tierOf(key) === TIER_BASIC);
            // `encrypt` is the deliberate exception: it is a decision the user
            // must make during onboarding, and the wizard applies it everywhere.
            expect(promoted.filter((key) => key !== "encrypt")).toEqual([]);
        });
    });

    describe("presentation contract", () => {
        it("uses sentence case for every section title", () => {
            for (const section of SETTING_SECTIONS) {
                const words = section.title.split(" ").slice(1);
                const titleCased = words.filter((w) => /^[A-Z][a-z]/.test(w));
                expect(titleCased, `"${section.title}" looks Title Cased`).toEqual([]);
            }
        });

        it("gives every section a summary that is a sentence", () => {
            for (const section of SETTING_SECTIONS) {
                expect(section.summary.length, section.id).toBeGreaterThan(10);
                expect(section.summary.endsWith("."), section.id).toBe(true);
            }
        });

        it("contains no emoji anywhere in its user-visible text", () => {
            const emoji = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}]/u;
            for (const section of SETTING_SECTIONS) {
                expect(section.title).not.toMatch(emoji);
                expect(section.summary).not.toMatch(emoji);
            }
        });
    });
});
