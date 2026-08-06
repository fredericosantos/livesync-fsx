import { LiveSyncSetting as Setting } from "./LiveSyncSetting.ts";
import type { ObsidianLiveSyncSettingTab } from "./ObsidianLiveSyncSettingTab.ts";
import type { PageFunctions } from "./SettingPane.ts";
import { visibleOnly } from "./SettingPane.ts";
import { sectionsForPane, TIER_ADVANCED, TIER_EXPERT, isAtLeast } from "./settingsCatalogue.ts";
import { renderIgnoreFileList } from "./controls/IgnoreFileList.ts";
import { renderDeviceName } from "./controls/DeviceName.ts";
import { renderPassphrase } from "./controls/Passphrase.ts";
import { paneSyncSettings } from "./PaneSyncSettings.ts";

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
    device: (tab, el) => renderDeviceName(tab, el),
    what: (tab, el) => renderWhatToSync(tab, el),
    privacy: (tab, el) => renderEncryption(tab, el),
};

export function paneSync(this: ObsidianLiveSyncSettingTab, paneEl: HTMLElement, funcs: PageFunctions): void {
    const tier = this.viewingTier;

    for (const section of sectionsForPane("sync", tier)) {
        void funcs.addPanel(paneEl, section.title).then((el) => {
            el.createDiv({ cls: "sls-setting-note", text: section.summary });
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

    // Panels that are behaviour rather than settings — enabling hidden-file
    // sync has to choose between merging, fetching and overwriting, and cannot
    // be expressed as a key. They stay in the original pane body, shown only
    // once the reader has asked for that much.
    if (isAtLeast(tier, TIER_EXPERT)) {
        paneSyncSettings.call(this, paneEl, funcs);
    }
}

function renderWhatToSync(tab: ObsidianLiveSyncSettingTab, el: HTMLElement): void {
    new Setting(el)
        .setName("Use ignore files")
        .setDesc("Honour gitignore-style rules found inside the vault.")
        .autoWireToggle("useIgnoreFiles");

    renderIgnoreFileList(tab, el);

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

/** Advanced sections have no custom rendering; they are plain key lists. */
export const ADVANCED_SYNC_TIER = TIER_ADVANCED;
