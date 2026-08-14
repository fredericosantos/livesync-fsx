/**
 * The settings page, declared rather than drawn.
 *
 * Obsidian 1.13 asks a settings tab to *describe* itself: a tree of definitions
 * with names, descriptions and control types. It renders them, and — the reason
 * this exists — indexes them, so typing "passphrase" into Obsidian's own
 * settings search finds the row rather than nothing at all. A tab that only
 * implements `display()` is invisible to that search, which is what this plugin
 * was.
 *
 * It is all or nothing: the moment `getSettingDefinitions()` returns a non-empty
 * array, `display()` is never called again. So everything on the page has to be
 * expressible here, including the parts that are not a switch or a text box —
 * the plug-in table, the size chips, the sync line, the buttons. Those use the
 * `render` form, which hands back a `Setting` to populate imperatively.
 *
 * The important part is that a `render` row still carries a `name` and a `desc`.
 * Search indexes those, so a bespoke control is no less findable than a toggle;
 * it is only drawn differently. That is why every row below has real words on
 * it even when nothing reads them aloud.
 */

import type { SettingDefinitionGroup, SettingDefinitionItem, SettingGroupItem } from "obsidian";
import type { ObsidianLiveSyncSettingTab } from "./ObsidianLiveSyncSettingTab.ts";
import { sectionsFor, type SettingKey, type SettingSection } from "./settingsCatalogue.ts";
import { AllSettingDefault, getConfig, type AllSettingItemKey } from "./settingConstants.ts";
import { SECTION_DEFINITIONS } from "./sectionDefinitions.ts";
import { $msg } from "@/common/translation";

/** Copy we deliberately override, applied over the schema's own words. */
const COPY: Partial<Record<SettingKey, { name: string; desc?: string }>> = {
    encrypt: {
        name: "Encrypt this vault",
        desc: "Every device must use the same passphrase, or they cannot read each other's notes.",
    },
    useIgnoreFiles: {
        name: "Use ignore files",
        desc: "Skip anything excluded by a gitignore-style file in the vault.",
    },
};

/**
 * A key's row, from its schema entry.
 *
 * The type of its default decides the control, exactly as the imperative
 * renderer decided which `autoWire*` to call. A key whose default is not a
 * primitive has no generic control and must be listed in
 * {@link SECTION_DEFINITIONS}; throwing is deliberate, because rendering
 * nothing silently is how a setting ends up on the page as a name with no way
 * to change it.
 */
function defineKey(key: SettingKey): SettingGroupItem {
    const itemKey = key as SettingKey & AllSettingItemKey;
    const copy = COPY[key];
    // `getConfig` returns false for a key the schema does not describe. Falling
    // back to the key itself keeps such a row visible and findable rather than
    // nameless, which is the failure that hides a setting in plain sight.
    const conf = getConfig(itemKey) || undefined;
    const name = copy?.name ?? conf?.name ?? itemKey;
    const desc = copy?.desc ?? conf?.desc ?? "";
    const defaultValue = AllSettingDefault[itemKey];

    switch (typeof defaultValue) {
        case "boolean":
            return { name, desc, control: { type: "toggle", key: itemKey, defaultValue } };
        case "number":
            return { name, desc, control: { type: "number", key: itemKey, defaultValue } };
        case "string":
            return { name, desc, control: { type: "text", key: itemKey, defaultValue } };
        default:
            throw new Error(`No control for setting "${key}"; add one to SECTION_DEFINITIONS.`);
    }
}

function defineSection(tab: ObsidianLiveSyncSettingTab, section: SettingSection): SettingDefinitionGroup {
    // `SettingGroupItem` rather than `SettingDefinitionItem`: a group may hold
    // rows and lists, but not another group, and nothing here nests.
    const items: SettingGroupItem[] = section.keys.map((key) =>
        SECTION_DEFINITIONS.keys[key]?.(tab) ?? defineKey(key)
    );
    // The actions and bespoke controls that follow a section's plain keys.
    items.push(...(SECTION_DEFINITIONS.extras[section.extra ?? ""]?.(tab) ?? []));

    return {
        type: "group",
        // A group with no heading still groups: the connect row and the discard
        // row each stand alone, and a heading over one row is a label for a
        // label.
        ...(section.title ? { heading: section.title } : {}),
        items,
    };
}

/**
 * The staged-change banner.
 *
 * Some settings cannot take effect without rebuilding a database, so they are
 * held until confirmed rather than applied as they are typed. This says so, and
 * only while it is true — it used to be a perpetually scrolling striped bar,
 * which demanded attention continuously for a state the reader had just created
 * themselves.
 */
function rebuildBanner(tab: ObsidianLiveSyncSettingTab): SettingDefinitionItem {
    return {
        name: $msg("obsidianLiveSyncSettingTab.msgChangesNeedToBeApplied"),
        desc: "",
        visible: () => tab.isNeedRebuildLocal() || tab.isNeedRebuildRemote(),
        render: (setting) => {
            setting.settingEl.addClass("lsfsx-setting-menu-buttons");
            setting.addButton((button) =>
                button
                    .setButtonText($msg("obsidianLiveSyncSettingTab.optionApply"))
                    .setWarning()
                    .onClick(() => void tab.confirmRebuild())
            );
        },
    };
}

export function buildSettingDefinitions(tab: ObsidianLiveSyncSettingTab): SettingDefinitionItem[] {
    // The catalogue already decides what a configured and an unconfigured vault
    // each see, and in what order. This only changes how the answer is spelled.
    const sections = sectionsFor(tab.editingSettings?.isConfigured === true)
        .filter(
            (section) =>
                !section.shownWhen || tab.isConfiguredAs(section.shownWhen.key as never, section.shownWhen.is as never)
        )
        .map((section) => defineSection(tab, section));
    return [rebuildBanner(tab), ...sections];
}
