import { LOG_LEVEL_NOTICE } from "@vrtmrz/livesync-commonlib/compat/common/types";
import { LiveSyncCommands } from "@/features/LiveSyncCommands.ts";
import { HOLD_SUSPENDED, syncHold } from "@/common/syncHold.ts";

/**
 * The two ways out when synchronisation has gone wrong.
 *
 * These used to live on a "Maintenance" settings pane alongside a dozen
 * debugging levers — server locks, garbage collection, chunk resends — which
 * put "delete the remote database" the same distance from the reader as "sync
 * hidden files". The levers are gone; these two are not, because without them a
 * broken vault has no repair path short of uninstalling.
 *
 * They are commands rather than settings for the obvious reason: they are
 * things you do once, not preferences you keep. Obsidian's command palette is
 * where a user already looks for an action.
 */
export class CmdRecovery extends LiveSyncCommands {
    onunload(): void {
        // NO OP.
    }

    onload(): void {
        // Obsidian already namespaces a command as `<plugin id>:<id>`, so the
        // prefix these three carried made them `livesync-fsx:livesync-fsx-…`.
        // The older commands here keep their inherited `livesync-` ids: those
        // are not the plug-in's id, nothing is duplicated by them, and an id is
        // what a configured hotkey is bound to.
        this.plugin.addCommand({
            id: "rebuild-remote",
            name: "Repair sync: replace files on server",
            callback: () => {
                void this.confirmAndRebuild(
                    "remoteOnly",
                    "This vault will overwrite the remote vault. Any changes made on other " +
                        "devices that have not synced to this device will be lost."
                );
            },
        });

        this.plugin.addCommand({
            id: "fetch-local",
            name: "Repair sync: replace files on this device",
            callback: () => {
                void this.confirmAndRebuild(
                    "localOnly",
                    "The remote vault will overwrite this vault. Any changes made here that " +
                        "have not synced to the server are kept as a second copy of the file."
                );
            },
        });

        // One pause, one command, and a name that says which way it will go.
        // There used to be two unrelated mechanisms sharing the word "suspend":
        // a "Toggle All Sync." command that suspended the plug-in in memory, so
        // the pause was forgotten on the next restart, and this pair of stored
        // flags, which only a separate "Resume synchronisation" command could
        // clear. A reader who paused and reopened Obsidian could not tell which
        // of the two they had used, or why it had come back on.
        this.plugin.addCommand({
            id: "resume",
            name: "Pause or resume synchronisation",
            callback: () => {
                void (this.isPaused() ? this.resume() : this.pause());
            },
        });
    }

    private isPaused(): boolean {
        return this.settings.suspendFileWatching === true || this.settings.suspendParseReplicationResult === true;
    }

    private async pause(): Promise<void> {
        this.settings.suspendFileWatching = true;
        this.settings.suspendParseReplicationResult = true;
        await this.core.services.setting.saveSettingData();
        syncHold.value = HOLD_SUSPENDED;
        this._log("Synchronisation paused. It stays paused until you resume it.", LOG_LEVEL_NOTICE);
    }

    /**
     * Ends a suspension.
     *
     * Start-up used to ask about this, offering "Keep LiveSync disabled" or
     * "Resume and restart" in front of a vault the reader had just opened. The
     * suspension is theirs and it persists; ending it is a thing they do, once,
     * when they decide to.
     */
    private async resume(): Promise<void> {
        this.settings.suspendFileWatching = false;
        this.settings.suspendParseReplicationResult = false;
        await this.core.services.setting.saveSettingData();
        syncHold.value = undefined;
        this._log("Synchronisation resumed. Restarting Obsidian.", LOG_LEVEL_NOTICE);
        this.core.services.appLifecycle.scheduleRestart();
    }

    private async confirmAndRebuild(method: "localOnly" | "remoteOnly", consequence: string): Promise<void> {
        // Stated as what will be lost, not as "are you sure": the user cannot
        // consent to a risk that has not been named.
        const answer = await this.core.confirm.askYesNoDialog(consequence, {
            defaultOption: "No",
            title: "This cannot be undone",
        });
        if (answer != "yes") return;
        this._log("Repairing synchronisation. Do not close Obsidian until it finishes.", LOG_LEVEL_NOTICE);
        await this.core.rebuilder.$performRebuildDB(method);
    }
}
