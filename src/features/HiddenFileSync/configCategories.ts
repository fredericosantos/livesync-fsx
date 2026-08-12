/**
 * What each file in the configuration folder *is*, in the words Obsidian's own
 * Sync uses for it.
 *
 * Two systems used to synchronise this folder, and they had to be taught about
 * each other in order to coexist:
 *
 *  - Hidden File Sync replicated every dot-path as an ordinary file. One shared
 *    state, continuous, no interface. What synchronisation normally means.
 *  - Customisation Sync bundled the same files by category into one document
 *    *per device*, so the server held N labelled copies, and a pane let you
 *    choose whose copy to apply, per item, per device, by hand.
 *
 * The second is not synchronisation; it is a manual transfer with a filing
 * system. Its evidence was a method named `isNotIgnoredByCustomisationSync`,
 * which carved paths out of Hidden File Sync so the two would not fight over
 * the same file — a whole mechanism whose job was to stop the other mechanism.
 *
 * So there is one now, and it works the way Obsidian's Sync works: one shared
 * state, and a set of categories the reader can switch off. What is added
 * beyond Obsidian is the per-plugin choice, which Obsidian does not offer.
 */

import type { ObsidianLiveSyncSettings } from "@vrtmrz/livesync-commonlib/settings";

export const CONFIG_CATEGORIES = [
    "app",
    "appearance",
    "themesAndSnippets",
    "hotkeys",
    "corePluginList",
    "corePluginSettings",
    "communityPluginList",
    "communityPluginSettings",
] as const;

export type ConfigCategory = (typeof CONFIG_CATEGORIES)[number];

/** The setting that governs each category, and the label the reader sees. */
export const CONFIG_CATEGORY_SETTINGS = {
    app: { key: "syncConfigApp", name: "App settings" },
    appearance: { key: "syncConfigAppearance", name: "Appearance" },
    themesAndSnippets: { key: "syncConfigThemesAndSnippets", name: "Themes and snippets" },
    hotkeys: { key: "syncConfigHotkeys", name: "Hotkeys" },
    corePluginList: { key: "syncConfigCorePluginList", name: "Active core plugins" },
    corePluginSettings: { key: "syncConfigCorePluginSettings", name: "Core plugin settings" },
    communityPluginList: { key: "syncConfigCommunityPluginList", name: "Active community plugins" },
    communityPluginSettings: { key: "syncConfigCommunityPluginSettings", name: "Community plugin settings" },
} as const satisfies Record<ConfigCategory, { key: keyof ObsidianLiveSyncSettings; name: string }>;

/**
 * Files that describe one screen rather than one vault.
 *
 * `workspace.json` records which panes are open, how wide they are, and which
 * file each holds. Carrying it between a desktop and a phone rearranges the
 * phone to match the desktop, which is why Obsidian's own Sync leaves it alone.
 */
const DEVICE_LOCAL = new Set(["workspace.json", "workspace-mobile.json"]);

const APPEARANCE_DIRECTORIES = ["themes/", "snippets/"];

/** Files that are the core-plugin list rather than a core plugin's settings. */
const CORE_PLUGIN_LIST = new Set(["core-plugins.json", "core-plugins-migration.json"]);

const NAMED = new Map<string, ConfigCategory>([
    ["app.json", "app"],
    ["appearance.json", "appearance"],
    ["hotkeys.json", "hotkeys"],
    ["community-plugins.json", "communityPluginList"],
]);

export interface ConfigFileKind {
    readonly category: ConfigCategory;
    /** Set when the path belongs to one community plugin, so it can be chosen individually. */
    readonly pluginId?: string;
}

/**
 * Classifies a path *relative to the configuration folder*.
 *
 * `undefined` means the plug-in does not synchronise it at all — either because
 * it describes this screen, or because it is something Obsidian never put
 * there and we have no category to promise about.
 */
export function classifyConfigPath(relativePath: string): ConfigFileKind | undefined {
    if (!relativePath || relativePath.startsWith("/")) return undefined;
    if (DEVICE_LOCAL.has(relativePath)) return undefined;

    const named = NAMED.get(relativePath);
    if (named) return { category: named };
    if (CORE_PLUGIN_LIST.has(relativePath)) return { category: "corePluginList" };

    if (APPEARANCE_DIRECTORIES.some((directory) => relativePath.startsWith(directory))) {
        return { category: "themesAndSnippets" };
    }

    if (relativePath.startsWith("plugins/")) {
        const pluginId = relativePath.slice("plugins/".length).split("/")[0];
        // `plugins/` itself, or a stray file directly inside it, belongs to no
        // plugin and so cannot be chosen in the table. Nothing owns it.
        if (!pluginId || !relativePath.startsWith(`plugins/${pluginId}/`)) return undefined;
        return { category: "communityPluginSettings", pluginId };
    }

    // Every remaining top-level `*.json` is a core plugin's own settings —
    // `graph.json`, `daily-notes.json`, `bookmarks.json`, and whichever ones
    // Obsidian adds next. Naming them individually would mean a release of this
    // plug-in were required before a new core plugin could synchronise.
    if (!relativePath.includes("/") && relativePath.endsWith(".json")) {
        return { category: "corePluginSettings" };
    }

    return undefined;
}

/** Whether a plugin's own files are carried, given the table's choices. */
export function isPluginSelected(settings: ObsidianLiveSyncSettings, pluginId: string): boolean {
    const chosen = settings.syncConfigPluginSelection?.[pluginId];
    return chosen ?? settings.syncConfigNewPlugins ?? true;
}

/**
 * The single decision, for a path relative to the configuration folder.
 */
export function isConfigPathSynchronised(settings: ObsidianLiveSyncSettings, relativePath: string): boolean {
    const kind = classifyConfigPath(relativePath);
    if (!kind) return false;
    if (!settings[CONFIG_CATEGORY_SETTINGS[kind.category].key]) return false;
    if (kind.pluginId !== undefined && !isPluginSelected(settings, kind.pluginId)) return false;
    return true;
}
