import { LiveSyncSetting as Setting } from "./LiveSyncSetting.ts";
import type { ObsidianLiveSyncSettingTab } from "./ObsidianLiveSyncSettingTab.ts";
import type { PageFunctions } from "./SettingPane.ts";
import { paneAdvanced } from "./PaneAdvanced.ts";
import { panePowerUsers } from "./PanePowerUsers.ts";
import { TweakValuesRecommendedTemplate } from "@vrtmrz/livesync-commonlib/compat/common/models/tweak.definition";

/**
 * Performance and storage knobs. Upstream split these across an "Advanced" pane
 * and a "Power users" pane, which asked the reader to know which kind of user
 * they were before they could find a setting. They are one subject.
 *
 * These have correct answers, which upstream already ships as
 * `TweakValuesRecommendedTemplate`; the button below applies them so that the
 * whole pane can be ignored rather than answered.
 */
export function paneTuning(this: ObsidianLiveSyncSettingTab, paneEl: HTMLElement, funcs: PageFunctions): void {
    void funcs.addPanel(paneEl, "Recommended values").then((el) => {
        el.createDiv({
            cls: "sls-setting-note",
            text: "These settings have known good values. Nothing below needs an answer unless a specific problem calls for one.",
        });
        new Setting(el)
            .setName("Restore the recommended values")
            .setDesc("Overwrites every tuning value on this pane. Other devices are not affected.")
            .addButton((button) =>
                button.setButtonText("Restore").onClick(async () => {
                    this.editingSettings = { ...this.editingSettings, ...TweakValuesRecommendedTemplate };
                    await this.saveAllDirtySettings();
                    this.display();
                })
            );
    });

    paneAdvanced.call(this, paneEl, funcs);
    panePowerUsers.call(this, paneEl, funcs);
}
