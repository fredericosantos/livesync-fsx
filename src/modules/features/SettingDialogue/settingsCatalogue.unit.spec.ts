import { describe, expect, it } from "vitest";
import { AllSettingDefault } from "@vrtmrz/livesync-commonlib/compat/common/settingConstants";
import { TweakValuesShouldMatchedTemplate } from "@vrtmrz/livesync-commonlib/compat/common/models/tweak.definition";
import {
    SETTING_PANES,
    SETTING_SECTIONS,
    TIER_BASIC,
    TIER_EXPERT,
    cataloguedKeys,
    modeFlagsForTier,
    tierFromModeFlags,
    tierOf,
    type SettingKey,
} from "./settingsCatalogue.ts";

const schemaKeys = new Set(Object.keys(AllSettingDefault));

describe("settings catalogue", () => {
    it("names only keys that actually exist in the settings schema", () => {
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

    it("puts every section in a pane that exists", () => {
        const paneIds = new Set(SETTING_PANES.map((pane) => pane.id));
        const orphaned = SETTING_SECTIONS.filter((section) => !paneIds.has(section.pane));
        expect(orphaned.map((section) => `${section.id} -> ${section.pane}`)).toEqual([]);
    });

    it("keeps must-match tweaks out of the basic tier", () => {
        // Changing any of these without changing every other device breaks
        // replication, which is exactly the failure this vault already hit.
        // `encrypt` is the deliberate exception: it is a decision the user must
        // make during setup, and setup applies it everywhere at once.
        const mustMatch = Object.keys(TweakValuesShouldMatchedTemplate) as SettingKey[];
        const promoted = mustMatch.filter((key) => tierOf(key) === TIER_BASIC && key !== "encrypt");
        expect(promoted).toEqual([]);
    });
});

describe("tier derived from the mode booleans it replaces", () => {
    it("round-trips every tier through the stored flags", () => {
        for (const tier of [TIER_BASIC, "advanced", TIER_EXPERT] as const) {
            expect(tierFromModeFlags(modeFlagsForTier(tier)), tier).toBe(tier);
        }
    });

    it("reads an existing vault that set the mode booleans independently", () => {
        // Upstream let these be toggled in any combination. Anything beyond
        // plain Advanced has to land on Everything, or a setting the user had
        // already found would vanish from the dialogue after upgrading.
        expect(
            tierFromModeFlags({ useAdvancedMode: false, usePowerUserMode: false, useEdgeCaseMode: true })
        ).toBe(TIER_EXPERT);
        expect(
            tierFromModeFlags({ useAdvancedMode: false, usePowerUserMode: true, useEdgeCaseMode: false })
        ).toBe(TIER_EXPERT);
        expect(
            tierFromModeFlags({ useAdvancedMode: false, usePowerUserMode: false, useEdgeCaseMode: false })
        ).toBe(TIER_BASIC);
    });
});
