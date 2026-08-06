import { describe, expect, it } from "vitest";
import { SETTINGS_SCHEMA_DEFAULTS } from "@vrtmrz/livesync-commonlib/settings";
import { TweakValuesShouldMatchedTemplate } from "@vrtmrz/livesync-commonlib/compat/common/models/tweak.definition";
import { SETTING_SECTIONS, TIER_BASIC, cataloguedKeys, tierOf, type SettingKey } from "./settingsCatalogue.ts";

const schemaKeys = new Set(Object.keys(SETTINGS_SCHEMA_DEFAULTS));

describe("settings catalogue", () => {
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

    it("keeps must-match tweaks out of the basic tier", () => {
        // Changing any of these without changing every other device breaks
        // replication, which is exactly the failure this vault already hit.
        // `encrypt` is the deliberate exception: it is a decision the user must
        // make during onboarding, and setup applies it everywhere at once.
        const mustMatch = Object.keys(TweakValuesShouldMatchedTemplate) as SettingKey[];
        const promoted = mustMatch.filter((key) => tierOf(key) === TIER_BASIC && key !== "encrypt");
        expect(promoted).toEqual([]);
    });
});
