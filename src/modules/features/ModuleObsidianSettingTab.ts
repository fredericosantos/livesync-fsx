import { ObsidianLiveSyncSettingTab } from "./SettingDialogue/ObsidianLiveSyncSettingTab.ts";
import { AbstractObsidianModule } from "@/modules/AbstractObsidianModule.ts";
// import { PouchDB } from "../../lib/src/pouchdb/pouchdb-browser";
import { EVENT_REQUEST_OPEN_SETTING_WIZARD, EVENT_REQUEST_OPEN_SETTINGS, eventHub } from "@/common/events.ts";
import type { LiveSyncCore } from "@/main.ts";
import { openObsidianSettings } from "@/common/obsidianSettings.ts";

export class ModuleObsidianSettingDialogue extends AbstractObsidianModule {
    settingTab!: ObsidianLiveSyncSettingTab;

    _everyOnloadStart(): Promise<boolean> {
        this.settingTab = new ObsidianLiveSyncSettingTab(this.app, this.plugin);
        this.plugin.addSettingTab(this.settingTab);
        eventHub.onEvent(EVENT_REQUEST_OPEN_SETTINGS, () => this.openSetting());
        // The settings page opens on "Connect this vault" when the vault is
        // unconfigured, so the wizard request needs nothing beyond opening it.
        eventHub.onEvent(EVENT_REQUEST_OPEN_SETTING_WIZARD, () => this.openSetting());

        return Promise.resolve(true);
    }

    openSetting() {
        // The manifest's id, not the upstream one written down by hand. This
        // fork's id is `livesync-fsx`, so "open the settings" was asking
        // Obsidian to reveal a tab belonging to a different plug-in.
        openObsidianSettings(this.app, this.plugin.manifest.id);
    }

    get appId() {
        return `${"appId" in this.app ? this.app.appId : ""}`;
    }
    override onBindFunction(core: LiveSyncCore, services: typeof core.services): void {
        services.appLifecycle.onInitialise.addHandler(this._everyOnloadStart.bind(this));
    }
}
