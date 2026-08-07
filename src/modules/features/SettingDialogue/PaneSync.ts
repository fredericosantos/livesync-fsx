import { LiveSyncSetting as Setting } from "./LiveSyncSetting.ts";
import type { ObsidianLiveSyncSettingTab } from "./ObsidianLiveSyncSettingTab.ts";
import type { PageFunctions } from "./SettingPane.ts";
import { visibleOnly } from "./SettingPane.ts";
import { sectionsForPane } from "./settingsCatalogue.ts";
import { renderDeviceName } from "./controls/DeviceName.ts";
import { renderPassphrase } from "./controls/Passphrase.ts";

/**
 * The Sync pane, rendered from the settings catalogue rather than from a
 * hand-maintained sequence of panels.
 *
 * Most keys need nothing but their name, description and a control derived from
 * the type of their default. The handful that need more — a device name that
 * must be filled in, a passphrase that should not exist when encryption is off,
 * a list that was being edited as a comma-separated string — are handed to a
 * named renderer in `./controls`.
 */
type SectionRenderer = (
    tab: ObsidianLiveSyncSettingTab,
    el: HTMLElement,
    funcs: PageFunctions
) => void | Promise<void>;

const CUSTOM_SECTIONS: Record<string, SectionRenderer> = {
    basics: (tab, el) => renderBasics(tab, el),
    privacy: (tab, el) => renderEncryption(tab, el),
};

export function paneSync(this: ObsidianLiveSyncSettingTab, paneEl: HTMLElement, funcs: PageFunctions): void {
    for (const section of sectionsForPane("sync")) {
        // The title goes to the group, which renders it above the card. Adding
        // a heading inside the returned list element would put it in the card.
        void funcs.addPanel(paneEl, section.title).then((el) => {
            const custom = CUSTOM_SECTIONS[section.id];
            if (custom) {
                void custom(this, el, funcs);
                return;
            }
            for (const key of section.keys) {
                new Setting(el).autoWireSetting(key as never);
            }
        });
    }

}

function renderBasics(tab: ObsidianLiveSyncSettingTab, el: HTMLElement): void {
    renderDeviceName(tab, el);

    new Setting(el)
        .setName("Sync hidden files")
        .setDesc("Themes, snippets and plugin data under the configuration folder.")
        .autoWireToggle("syncInternalFiles");

    new Setting(el)
        .setName("Sync plugins and their settings")
        .setDesc("Customisation Sync. Needs a device name, above.")
        .autoWireToggle("usePluginSync");
}

function renderEncryption(tab: ObsidianLiveSyncSettingTab, el: HTMLElement): void {
    new Setting(el)
        .setName("Encrypt this vault")
        .setDesc("Every device must use the same passphrase, or they cannot read each other's notes.")
        .autoWireToggle("encrypt");
    tab.addOnSaved("encrypt", () => tab.display());

    // The passphrase is meaningless while encryption is off, so it is not shown
    // then. A disabled field would still invite the reader to wonder what it is
    // for; an absent one does not.
    renderPassphrase(tab, el, visibleOnly(() => tab.isConfiguredAs("encrypt", true)));
}

