import { LiveSyncSetting as Setting } from "@/modules/features/SettingDialogue/LiveSyncSetting.ts";
import type { ObsidianLiveSyncSettingTab } from "@/modules/features/SettingDialogue/ObsidianLiveSyncSettingTab.ts";
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

    const report = () => {
        const value = tab.editingSettings.deviceAndVaultName ?? "";
        const verdict = validateDeviceName(value, knownDeviceNames(tab));
        // Being nameless only matters once something depends on the name. The
        // message says which thing, at the field that can fix it, instead of a
        // permanent caveat printed under the toggle that caused it.
        const message =
            verdict.problem?.kind === "empty" && tab.isConfiguredAs("usePluginSync", true)
                ? "Needed before plugins and settings can sync."
                : verdict.message;
        problemEl.setText(message);
        problemEl.toggle(!verdict.ok);
        setting.settingEl.toggleClass("lsfsx-setting--invalid", !verdict.ok);
        return verdict.ok;
    };

    // Prefilled and adopted, not merely hinted. A placeholder leaves the stored
    // value empty, and an empty device name is exactly the state in which
    // Customisation Sync silently does nothing.
    if (!tab.editingSettings.deviceAndVaultName) {
        tab.editingSettings.deviceAndVaultName = suggestDeviceName(
            Platform,
            tab.plugin.app.vault.getName(),
            knownDeviceNames(tab)
        );
    }

    setting.addText((text) => {
        text.setValue(tab.editingSettings.deviceAndVaultName ?? "").onChange((value) => {
            // The value is still written while invalid; blocking the keystroke
            // would make the field impossible to correct mid-word. Saving is
            // what the verdict gates.
            tab.editingSettings.deviceAndVaultName = value;
            report();
        });
    });

    setting.addButton((button) =>
        button.setButtonText("Save").onClick(async () => {
            if (!report()) return;
            await tab.saveSettings(["deviceAndVaultName"]);
        })
    );

    // Re-run whenever anything on the page changes, so switching plugin sync on
    // flags the field immediately rather than at the next redraw.
    tab.controlledElementFunc.push(report);
    report();
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
