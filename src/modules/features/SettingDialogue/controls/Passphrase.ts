import { setIcon } from "@/deps.ts";
import { LiveSyncSetting as Setting } from "@/modules/features/SettingDialogue/LiveSyncSetting.ts";
import type { ObsidianLiveSyncSettingTab } from "@/modules/features/SettingDialogue/ObsidianLiveSyncSettingTab.ts";
import type { OnUpdateFunc } from "@/modules/features/SettingDialogue/SettingPane.ts";

/**
 * The end-to-end encryption passphrase.
 *
 * A masked field the user cannot read back is a trap: it is typed once, usually
 * on a phone keyboard, and must match exactly on every other device. The reveal
 * button is not a convenience, it is how the value gets verified.
 */
export function renderPassphrase(
    tab: ObsidianLiveSyncSettingTab,
    el: HTMLElement,
    visibility: OnUpdateFunc
): void {
    const setting = new Setting(el)
        .setName("Passphrase")
        .setDesc("Changing this rebuilds the remote database. Every device must then be given the new passphrase.")
        .addOnUpdate(visibility);

    let revealed = false;

    setting.addText((text) => {
        text.inputEl.type = "password";
        text.inputEl.autocapitalize = "off";
        text.inputEl.spellcheck = false;
        text.setPlaceholder("Required when encryption is on")
            .setValue(tab.editingSettings.passphrase ?? "")
            .onChange((value) => {
                tab.editingSettings.passphrase = value;
                tab.requestUpdate();
            });

        setting.addButton((button) => {
            const apply = () => {
                text.inputEl.type = revealed ? "text" : "password";
                setIcon(button.buttonEl, revealed ? "eye-off" : "eye");
                // The control is icon-only, so the label has to live somewhere
                // a screen reader and a hover can both reach it.
                button.setTooltip(revealed ? "Hide passphrase" : "Show passphrase");
                button.buttonEl.ariaLabel = revealed ? "Hide passphrase" : "Show passphrase";
            };
            button.onClick(() => {
                revealed = !revealed;
                apply();
            });
            apply();
        });
    });

    setting.addApplyButton(["passphrase"]);
}
