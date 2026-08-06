import { LiveSyncSetting as Setting } from "../LiveSyncSetting.ts";
import type { ObsidianLiveSyncSettingTab } from "../ObsidianLiveSyncSettingTab.ts";
import { validateDeviceName } from "./deviceNameRules.ts";
import { suggestDeviceName } from "./suggestDeviceName.ts";
import { Platform } from "@/deps.ts";

/**
 * The device name. Required, because Customisation Sync silently does nothing
 * without one — the most common reason it appears broken.
 *
 * Validation is inline and immediate rather than on save: the rules exist
 * because the value becomes part of a document key, and finding that out after
 * the fact means cleaning up bad keys.
 */
export function renderDeviceName(tab: ObsidianLiveSyncSettingTab, el: HTMLElement): void {
    const setting = new Setting(el)
        .setName("Device name")
        .setDesc("Shown on your other devices. Must be unique among them.");

    const problemEl = el.createDiv({ cls: "lsfsx-setting-problem" });
    problemEl.hide();

    const report = (value: string) => {
        const verdict = validateDeviceName(value, knownDeviceNames(tab));
        problemEl.setText(verdict.message);
        problemEl.toggle(!verdict.ok);
        setting.settingEl.toggleClass("lsfsx-setting--invalid", !verdict.ok);
        return verdict.ok;
    };

    // Prefilled, not merely hinted: an empty device name makes Customisation
    // Sync silently do nothing, and a placeholder leaves it empty.
    const suggestion = suggestDeviceName(Platform, tab.plugin.app.vault.getName(), knownDeviceNames(tab));

    setting.addText((text) => {
        text.setPlaceholder(suggestion)
            .setValue(tab.editingSettings.deviceAndVaultName || suggestion)
            .onChange((value) => {
                // The value is still written while invalid; blocking the keystroke
                // would make the field impossible to correct mid-word. Saving is
                // what the verdict gates.
                tab.editingSettings.deviceAndVaultName = value;
                report(value);
            });
        report(text.getValue());
    });

    setting.addButton((button) =>
        button.setButtonText("Save").onClick(async () => {
            if (!report(tab.editingSettings.deviceAndVaultName ?? "")) return;
            await tab.saveSettings(["deviceAndVaultName"]);
        })
    );
}

/**
 * Names already in use elsewhere.
 *
 * Only the names this device already knows about are available without a
 * remote read, so the uniqueness check is advisory: it catches the common case
 * of reusing a name from a device you can see, not a name on a device that has
 * never connected here.
 */
function knownDeviceNames(tab: ObsidianLiveSyncSettingTab): readonly string[] {
    const own = (tab.editingSettings.deviceAndVaultName ?? "").trim().toLowerCase();
    const extended = tab.editingSettings.pluginSyncExtendedSetting ?? {};
    return Object.keys(extended)
        .map((key) => key.split("/")[0])
        .filter((name) => name !== "" && name.toLowerCase() !== own);
}
