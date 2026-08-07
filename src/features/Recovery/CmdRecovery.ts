import { LOG_LEVEL_NOTICE } from "@vrtmrz/livesync-commonlib/compat/common/types";
import { LiveSyncCommands } from "@/features/LiveSyncCommands.ts";

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
        this.plugin.addCommand({
            id: "livesync-fsx-rebuild-remote",
            name: "Repair sync: replace the server's copy with this device",
            callback: () => {
                void this.confirmAndRebuild(
                    "remoteOnly",
                    "Everything on the server will be replaced by the files on this device. " +
                        "Other devices will download the result. Changes made only on another " +
                        "device, and not yet received here, will be lost."
                );
            },
        });

        this.plugin.addCommand({
            id: "livesync-fsx-fetch-local",
            name: "Repair sync: replace this device with the server's copy",
            callback: () => {
                void this.confirmAndRebuild(
                    "localOnly",
                    "The files on this device will be replaced by the server's copy. " +
                        "Changes made only here, and not yet sent, will be lost."
                );
            },
        });

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
