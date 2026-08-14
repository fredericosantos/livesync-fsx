import { describe, expect, it } from "vitest";
import { describeConfigFile, describeRevision } from "./describeConfigFile.ts";

describe("describeConfigFile", () => {
    it("names the plugin when it is installed here", () => {
        const names = new Map([["obsidian-excalidraw-plugin", "Excalidraw"]]);
        const described = describeConfigFile("plugins/obsidian-excalidraw-plugin/data.json", names);
        expect(described.title).toBe("Excalidraw settings need a decision");
        expect(described.file).toBe("data.json");
    });

    it("falls back to the folder name for a plugin this device has never had", () => {
        // A real case: a conflict can arrive for a plugin that is not installed
        // here. The id is recognisable; inventing a prettier name would be a
        // guess presented as a fact.
        const described = describeConfigFile("plugins/iconic/data.json");
        expect(described.title).toBe("iconic settings need a decision");
    });

    it("uses Obsidian's own words for Obsidian's own files", () => {
        expect(describeConfigFile("hotkeys.json").title).toBe("Hotkeys need a decision");
        expect(describeConfigFile("appearance.json").title).toBe("Appearance settings need a decision");
    });

    it("says the path for something it has no name for", () => {
        // Better than calling it "a setting" and making the reader go looking.
        const described = describeConfigFile("something-new.json");
        expect(described.title).toContain("something-new.json");
    });
});

describe("describeRevision", () => {
    const noon = new Date(2026, 7, 14, 12, 0).getTime();

    it("names the device that wrote it", () => {
        expect(describeRevision("Fred's MacBook", noon, noon)).toContain("Fred's MacBook");
    });

    it("still identifies the version when no device was recorded", () => {
        // Revisions written before devices were recorded have no name, and
        // there is no way to work it out afterwards. The time still tells the
        // two sides apart, which is what the reader is choosing between.
        const described = describeRevision(undefined, noon, noon);
        expect(described).toContain("Unknown device");
        expect(described).not.toBe("Unknown device");
    });

    it("includes the date only when it is not today", () => {
        const today = describeRevision("iPhone", noon, noon);
        const lastWeek = describeRevision("iPhone", new Date(2026, 7, 7, 12, 0).getTime(), noon);
        expect(lastWeek.length).toBeGreaterThan(today.length);
    });
});
