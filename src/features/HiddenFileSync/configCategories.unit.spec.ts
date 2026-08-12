import { describe, expect, it } from "vitest";
import type { ObsidianLiveSyncSettings } from "@vrtmrz/livesync-commonlib/settings";
import { classifyConfigPath, isConfigPathSynchronised, isPluginSelected } from "./configCategories.ts";

const allOn = {
    syncConfigApp: true,
    syncConfigAppearance: true,
    syncConfigThemesAndSnippets: true,
    syncConfigHotkeys: true,
    syncConfigCorePluginList: true,
    syncConfigCorePluginSettings: true,
    syncConfigCommunityPluginList: true,
    syncConfigCommunityPluginSettings: true,
    syncConfigPluginSelection: {},
    syncConfigNewPlugins: true,
} as ObsidianLiveSyncSettings;

describe("classifyConfigPath", () => {
    it("names the files Obsidian's own Sync names", () => {
        expect(classifyConfigPath("app.json")?.category).toBe("app");
        expect(classifyConfigPath("appearance.json")?.category).toBe("appearance");
        expect(classifyConfigPath("hotkeys.json")?.category).toBe("hotkeys");
        expect(classifyConfigPath("core-plugins.json")?.category).toBe("corePluginList");
        expect(classifyConfigPath("community-plugins.json")?.category).toBe("communityPluginList");
        expect(classifyConfigPath("themes/Minimal/theme.css")?.category).toBe("themesAndSnippets");
        expect(classifyConfigPath("snippets/mine.css")?.category).toBe("themesAndSnippets");
    });

    it("treats an unrecognised top-level json as a core plugin's settings", () => {
        // So that a core plugin Obsidian adds next year synchronises without a
        // release of this plug-in naming it first.
        expect(classifyConfigPath("graph.json")?.category).toBe("corePluginSettings");
        expect(classifyConfigPath("daily-notes.json")?.category).toBe("corePluginSettings");
        expect(classifyConfigPath("something-invented-later.json")?.category).toBe("corePluginSettings");
    });

    it("attributes every file under a plugin folder to that plugin", () => {
        for (const path of [
            "plugins/dataview/main.js",
            "plugins/dataview/manifest.json",
            "plugins/dataview/styles.css",
            "plugins/dataview/data.json",
            "plugins/dataview/deep/nested/asset.bin",
        ]) {
            expect(classifyConfigPath(path)).toEqual({
                category: "communityPluginSettings",
                pluginId: "dataview",
            });
        }
    });

    it("never carries the window layout, which describes one screen", () => {
        expect(classifyConfigPath("workspace.json")).toBeUndefined();
        expect(classifyConfigPath("workspace-mobile.json")).toBeUndefined();
    });

    it("claims nothing it has no category for", () => {
        expect(classifyConfigPath("plugins")).toBeUndefined();
        expect(classifyConfigPath("plugins/stray-file.txt")).toBeUndefined();
        expect(classifyConfigPath("some/unknown/place.txt")).toBeUndefined();
        expect(classifyConfigPath("")).toBeUndefined();
    });
});

describe("isConfigPathSynchronised", () => {
    it("lets one category be switched off without disturbing the others", () => {
        const settings = { ...allOn, syncConfigHotkeys: false };

        expect(isConfigPathSynchronised(settings, "hotkeys.json")).toBe(false);
        expect(isConfigPathSynchronised(settings, "app.json")).toBe(true);
    });

    it("requires both the category and the plugin's own row", () => {
        const settings = {
            ...allOn,
            syncConfigPluginSelection: { dataview: false, templater: true },
        } as ObsidianLiveSyncSettings;

        expect(isConfigPathSynchronised(settings, "plugins/dataview/main.js")).toBe(false);
        expect(isConfigPathSynchronised(settings, "plugins/templater/main.js")).toBe(true);

        const categoryOff = { ...settings, syncConfigCommunityPluginSettings: false };
        expect(isConfigPathSynchronised(categoryOff, "plugins/templater/main.js")).toBe(false);
    });

    it("follows the stated answer for plugins the table has never seen", () => {
        expect(isPluginSelected(allOn, "installed-elsewhere-yesterday")).toBe(true);
        expect(isPluginSelected({ ...allOn, syncConfigNewPlugins: false }, "installed-elsewhere-yesterday")).toBe(
            false
        );
    });
});
