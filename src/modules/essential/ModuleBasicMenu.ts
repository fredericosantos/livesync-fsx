import type { LiveSyncCore } from "@/main";
import { fireAndForget } from "octagonal-wheels/promises";
import { AbstractModule } from "@/modules/AbstractModule";
import { $msg } from "@/common/translation";
import { copyFileDatabaseInfo } from "@/serviceFeatures/fileDatabaseInfo";
// Separated Module for basic menu commands, which are not related to obsidian specific features. It is expected to be used in other platforms with minimal changes.
// However, it is odd that it has here at all; it really ought to be in each respective feature. It will likely be moved eventually. Until now, addCommand pointed to Obsidian's version.
export class ModuleBasicMenu extends AbstractModule {
    _everyOnloadStart(): Promise<boolean> {
        this.addCommand({
            id: "livesync-replicate",
            name: $msg("Sync now"),
            callback: async () => {
                await this.services.replication.replicate();
            },
        });
        this.addCommand({
            id: "livesync-dump",
            name: $msg("Copy database information for the active file"),
            checkCallback: (checking) => {
                const file = this.services.vault.getActiveFilePath();
                if (!file) return false;
                if (!checking) {
                    fireAndForget(() => copyFileDatabaseInfo(this.core, file));
                }
                return true;
            },
        });
        // Pausing lives in `CmdRecovery`, in one command, because there is one
        // pause. There used to be two independent ones: this module suspended
        // the plug-in in memory, so the pause was forgotten on the next restart,
        // while `suspendFileWatching` and `suspendParseReplicationResult` were
        // written to disk by a different command. Two mechanisms, one word for
        // them in the interface, and no way for the reader to tell which they
        // had. A third command, "Toggle LiveSync", turned off continuous
        // replication under a name that sounded like all of it, and duplicated
        // a switch already on the settings page.
        //
        // The one repair left here is the one nothing else does: reconcile what
        // is on disk with what the database believes. "Abort synchronisation
        // immediately" and "Apply pending changes now" both went — the first is
        // what pausing does, the second is what the batch timer does a moment
        // later on its own. Neither was reachable in any case: both were gated
        // on an advanced mode that had no way to be switched on.
        this.addCommand({
            id: "livesync-scan-files",
            name: "Scan storage and database again",
            callback: async () => {
                await this.services.vault.scanVault(true);
            },
        });

        return Promise.resolve(true);
    }

    override onBindFunction(core: LiveSyncCore, services: typeof core.services): void {
        services.appLifecycle.onInitialise.addHandler(this._everyOnloadStart.bind(this));
    }
}
