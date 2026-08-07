import { describe, expect, it } from "vitest";
import { AllSettingDefault } from "@vrtmrz/livesync-commonlib/compat/common/settingConstants";
import { TweakValuesShouldMatchedTemplate } from "@vrtmrz/livesync-commonlib/compat/common/models/tweak.definition";
import {
    SETTING_PANES,
    SETTING_SECTIONS,
    cataloguedKeys,
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

    it("shows no must-match tweak except the one setup is about", () => {
        // Changing any of these without changing every other device breaks
        // replication. `encrypt` is the deliberate exception: it is a decision
        // the user must make, and setup applies it everywhere at once.
        const mustMatch = Object.keys(TweakValuesShouldMatchedTemplate) as SettingKey[];
        const shown = new Set(cataloguedKeys());
        const exposed = mustMatch.filter((key) => shown.has(key) && key !== "encrypt");
        expect(exposed).toEqual([]);
    });
});
