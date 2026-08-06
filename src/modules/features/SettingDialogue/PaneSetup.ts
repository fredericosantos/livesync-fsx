import { $msg } from "@/common/translation";
import { LiveSyncSetting as Setting } from "./LiveSyncSetting.ts";
import {
    EVENT_REQUEST_COPY_SETUP_URI,
    EVENT_REQUEST_OPEN_SETUP_URI,
    EVENT_REQUEST_SHOW_SETUP_QR,
    eventHub,
} from "@/common/events.ts";
import type { ObsidianLiveSyncSettingTab } from "./ObsidianLiveSyncSettingTab.ts";
import type { PageFunctions } from "./SettingPane.ts";
import { visibleOnly } from "./SettingPane.ts";
import { SetupManager } from "@/modules/features/SetupManager.ts";
import { TIERS, TIER_DESCRIPTIONS, TIER_LABELS, modeFlagsForTier, type SettingTier } from "./settingsCatalogue.ts";
import {
    createCoreSettingsAfterFullReset,
    createEditingSettingsAfterFullReset,
} from "@/serviceFeatures/setupObsidian/settingsReset.ts";
export function paneSetup(
    this: ObsidianLiveSyncSettingTab,
    paneEl: HTMLElement,
    { addPanel, addPane }: PageFunctions
): void {
    // An unconfigured vault has exactly one thing to do, so it is the only
    // thing offered. Everything else on this pane is for a vault that already
    // works, and stays out of the way until then.
    void addPanel(paneEl, "Connect this vault", undefined, visibleOnly(() => !this.isConfiguredAs("isConfigured", true))).then(
        (paneEl) => {
            paneEl.createDiv({
                cls: "sls-setting-note",
                text: "This vault is not synchronising yet. Connecting takes three steps: where the server is, whether to encrypt, and what to do with the files already here.",
            });
            new Setting(paneEl)
                .setName("Set up synchronisation")
                .setDesc("Asks for the server address, then reports what it found there before changing anything.")
                .addButton((text) => {
                    text.setButtonText("Start")
                        .setCta()
                        .onClick(async () => {
                            await this.core.getModule(SetupManager).startOnBoarding();
                        });
                });
            new Setting(paneEl)
                .setName("Use a setup link from another device")
                .setDesc("Copies an existing device's connection instead of typing it again.")
                .addButton((text) => {
                    text.setButtonText("Paste link").onClick(() => {
                        this.closeSetting();
                        eventHub.emitEvent(EVENT_REQUEST_OPEN_SETUP_URI);
                    });
                });
            // Scanning works through the `obsidian://` protocol handler without
            // any help from here, but only for someone who already knows the
            // steps. This is the entry point to the instructions for someone
            // who does not.
            new Setting(paneEl)
                .setName("Scan a QR code from another device")
                .setDesc("Useful on a phone, where typing a server address and passphrase is the worst part.")
                .addButton((text) => {
                    text.setButtonText("Show me how").onClick(async () => {
                        await this.core.getModule(SetupManager).onPromptQRCodeInstruction();
                    });
                });
        }
    );

    void addPanel(
        paneEl,
        "Connection",
        undefined,
        visibleOnly(() => this.isConfiguredAs("isConfigured", true))
    ).then((paneEl) => {
        new Setting(paneEl)
            .setName("Change the connection")
            .setDesc("Reopens setup against this vault's current settings.")
            .addButton((text) => {
                text.setButtonText("Reconfigure").onClick(async () => {
                    await this.core.getModule(SetupManager).startOnBoarding();
                });
            });
    });

    void addPanel(
        paneEl,
        $msg("obsidianLiveSyncSettingTab.titleSetupOtherDevices"),
        undefined,
        visibleOnly(() => this.isConfiguredAs("isConfigured", true))
    ).then((paneEl) => {
        new Setting(paneEl)
            .setName($msg("obsidianLiveSyncSettingTab.nameCopySetupURI"))
            .setDesc($msg("obsidianLiveSyncSettingTab.descCopySetupURI"))
            .addButton((text) => {
                text.setButtonText($msg("obsidianLiveSyncSettingTab.btnCopy")).onClick(() => {
                    // await this.plugin.addOnSetup.command_copySetupURI();
                    eventHub.emitEvent(EVENT_REQUEST_COPY_SETUP_URI);
                });
            });
        new Setting(paneEl)
            .setName($msg("Setup.ShowQRCode"))
            .setDesc($msg("Setup.ShowQRCode.Desc"))
            .addButton((text) => {
                text.setButtonText($msg("Setup.ShowQRCode")).onClick(() => {
                    eventHub.emitEvent(EVENT_REQUEST_SHOW_SETUP_QR);
                });
            });
    });

    void addPanel(paneEl, "How much to show").then((paneEl) => {
        // Upstream had three independent switches — Advanced, Power user, Edge
        // case — which the reader had to combine correctly to find a setting.
        // They are one question with an ordered answer, so they are asked once.
        // The three booleans are still what gets stored; see settingsCatalogue.
        const current = this.viewingTier;
        new Setting(paneEl)
            .setName("Settings shown")
            .setDesc(TIER_DESCRIPTIONS[current])
            .addDropdown((dropdown) => {
                for (const tier of TIERS) dropdown.addOption(tier, TIER_LABELS[tier]);
                dropdown.setValue(current).onChange(async (value) => {
                    this.editingSettings = { ...this.editingSettings, ...modeFlagsForTier(value as SettingTier) };
                    await this.saveAllDirtySettings();
                    this.display();
                });
            });
    });

    void addPanel(
        paneEl,
        $msg("obsidianLiveSyncSettingTab.titleReset"),
        undefined,
        // The panel is gated on the same condition as its only control; without
        // this it rendered as a heading with nothing underneath.
        visibleOnly(() => this.isConfiguredAs("isConfigured", true))
    ).then((paneEl) => {
        new Setting(paneEl)
            .setName($msg("obsidianLiveSyncSettingTab.nameDiscardSettings"))
            .addButton((text) => {
                text.setButtonText($msg("obsidianLiveSyncSettingTab.btnDiscard"))
                    .onClick(async () => {
                        if (
                            (await this.core.confirm.askYesNoDialog(
                                $msg("obsidianLiveSyncSettingTab.msgDiscardConfirmation"),
                                { defaultOption: "No" }
                            )) == "yes"
                        ) {
                            this.editingSettings = createEditingSettingsAfterFullReset(this.editingSettings);
                            await this.saveAllDirtySettings();
                            this.core.settings = createCoreSettingsAfterFullReset();
                            await this.services.setting.saveSettingData();
                            await this.services.database.resetDatabase();
                            // await this.plugin.initializeDatabase();
                            this.services.appLifecycle.askRestart();
                        }
                    })
                    .setWarning();
            })
            .addOnUpdate(visibleOnly(() => this.isConfiguredAs("isConfigured", true)));
    });

    void addPanel(paneEl, "Help").then((paneEl) => {
        // This panel used to fetch upstream's troubleshooting guide over the
        // network on every open and render the whole document inline. It ran to
        // several screens, pushed every actual control off the page, and its
        // advice covers Object Storage and P2P — neither of which exists in this
        // fork, so following it would send a reader looking for settings that
        // were deliberately removed. A link is the honest size for it.
        new Setting(paneEl)
            .setName("Upstream troubleshooting guide")
            .setDesc("Written for Self-hosted LiveSync. Sections on Object Storage and P2P do not apply to this fork.")
            .addButton((button) =>
                button.setButtonText("Open in browser").onClick(() => {
                    window.open("https://github.com/vrtmrz/obsidian-livesync/blob/main/docs/troubleshooting.md", "_blank");
                })
            );
    });
}
