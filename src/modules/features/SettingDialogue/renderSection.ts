/**
 * How a catalogue section becomes a group of controls.
 *
 * There is one rule: a key is rendered from its schema entry — upstream already
 * supplies the name, the description and the default, and the type of that
 * default decides the control. Only keys that genuinely cannot be expressed
 * that way (a name that must be validated, a masked passphrase, a list that
 * would otherwise be a comma-separated string) get an entry in `KEY_RENDERERS`,
 * and only copy we deliberately disagree with gets an entry in `COPY`.
 *
 * Panes used to do this by hand, which is how "Appearance" ended up rendered
 * twice and how two adjacent groups ended up with different spacing.
 */

import { LiveSyncSetting as Setting } from "./LiveSyncSetting.ts";
import type { ObsidianLiveSyncSettingTab } from "./ObsidianLiveSyncSettingTab.ts";
import { visibleOnly } from "./SettingPane.ts";
import type { SettingKey, SettingSection } from "./settingsCatalogue.ts";
import { AllSettingDefault, type AllSettingItemKey } from "./settingConstants.ts";
import { renderPassphrase } from "./controls/Passphrase.ts";
import { renderIgnoreFileList } from "./controls/IgnoreFileList.ts";
import { HiddenFileSync } from "@/features/HiddenFileSync/CmdHiddenFileSync.ts";

type KeyRenderer = (tab: ObsidianLiveSyncSettingTab, el: HTMLElement) => void;

/** Copy we deliberately override, applied after the schema name and description. */
const COPY: Partial<Record<SettingKey, { name: string; desc?: string }>> = {
    syncInternalFiles: {
        name: "Sync app settings and plugins",
        desc: "Choose what travels below. Window layout always stays on the device it belongs to.",
    },
    // The eight category settings are no longer rendered one-to-one; five rows
    // cover them, and their names live with the grouping that produces them in
    // `controls/ConfigCategories.ts`.
    encrypt: {
        name: "Encrypt this vault",
        desc: "Every device must use the same passphrase, or they cannot read each other's notes.",
    },
    useIgnoreFiles: {
        name: "Use ignore files",
        desc: "Skip anything excluded by a gitignore-style file in the vault.",
    },
};

const KEY_RENDERERS: Partial<Record<SettingKey, KeyRenderer>> = {
    // Meaningless while encryption is off, so it is not shown then. A disabled
    // field would still invite the reader to wonder what it is for.
    passphrase: (tab, el) => renderPassphrase(tab, el, visibleOnly(() => tab.isConfiguredAs("encrypt", true))),
    ignoreFiles: (tab, el) => renderIgnoreFileList(tab, el),
    syncInternalFiles: (tab, el) => renderConfigSyncSwitch(tab, el),
};

/**
 * Turning this on has to *do* something, which is the part that was missing.
 *
 * Storing `syncInternalFiles: true` only tells the file watcher to stop
 * ignoring the configuration folder from now on. The files already sitting in
 * it — every theme, hotkey and plug-in setting that existed before the switch
 * was flipped — are enumerated by a separate initialisation, and nothing was
 * calling it. So the switch went on, stayed on, and synchronised nothing until
 * one of those files happened to be edited.
 *
 * `MERGE` is the direction, and it is not offered as a choice: it keeps both
 * sides and takes the newer of each file, which is the answer that cannot lose
 * anything. "Take the server's" and "take mine" both discard a device's
 * settings, and the reader enabling a switch called "Sync app settings and
 * plugins" has not been told they are about to choose that.
 */
function renderConfigSyncSwitch(tab: ObsidianLiveSyncSettingTab, el: HTMLElement): void {
    const copy = COPY.syncInternalFiles!;
    new Setting(el)
        .setName(copy.name)
        .setDesc(copy.desc ?? "")
        .addToggle((toggle) =>
            toggle.setValue(tab.editingSettings.syncInternalFiles === true).onChange(async (value) => {
                const hiddenFileSync = tab.core.addOns.find((addOn) => addOn instanceof HiddenFileSync);
                if (!hiddenFileSync) return;
                await hiddenFileSync.configureHiddenFileSync(value ? "MERGE" : "DISABLE_HIDDEN");
                tab.editingSettings.syncInternalFiles = tab.core.settings.syncInternalFiles;
                // Redrawn outright rather than nudged. The rest of this section
                // — the categories and the plug-in list — is revealed by this
                // switch, and the parts that reveal it were built for a value
                // changing under an open page, not for the page's own control
                // changing it. The result was a switch that moved and a page
                // that did not.
                tab.display();
            })
        );
}

/**
 * The default control for a key: whatever its schema default's type implies.
 * A key whose default is not a primitive has no generic control and must be
 * listed in `KEY_RENDERERS`; rendering nothing silently is how a setting ends
 * up on the page as a name with no way to change it.
 */
function renderKey(tab: ObsidianLiveSyncSettingTab, el: HTMLElement, key: SettingKey): void {
    const custom = KEY_RENDERERS[key];
    if (custom) {
        custom(tab, el);
        return;
    }
    const itemKey = key as SettingKey & AllSettingItemKey;
    const setting = new Setting(el);
    switch (typeof AllSettingDefault[itemKey]) {
        case "boolean":
            setting.autoWireToggle(itemKey as never);
            break;
        case "number":
            setting.autoWireNumeric(itemKey as never, {});
            break;
        case "string":
            setting.autoWireText(itemKey as never);
            break;
        default:
            throw new Error(`No control for setting "${key}"; add one to KEY_RENDERERS.`);
    }
    const copy = COPY[key];
    if (copy) {
        setting.setName(copy.name);
        if (copy.desc) setting.setDesc(copy.desc);
    }
}

export function renderSection(tab: ObsidianLiveSyncSettingTab, el: HTMLElement, section: SettingSection): void {
    for (const key of section.keys) {
        renderKey(tab, el, key);
    }
}
