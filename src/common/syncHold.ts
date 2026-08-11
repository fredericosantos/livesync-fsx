/**
 * Why synchronisation is not running, when it is not running for a reason the
 * user could act on.
 *
 * Both of these used to be modal dialogues raised from the middle of ordinary
 * work — one at start-up, one from inside a replication that had just failed.
 * Neither is a moment: they last until something is done about them, and a
 * condition that lasts belongs in the status bar, where it can be seen and
 * ignored until the reader has time for it.
 *
 * One source, because there is at most one reason to show at a time and the
 * status bar has room for exactly one.
 */

import { reactiveSource } from "octagonal-wheels/dataobject/reactive";

export const HOLD_COMPATIBILITY = "compatibility";
export const HOLD_REMOTE_REBUILT = "remote-rebuilt";

export type SyncHoldReason = typeof HOLD_COMPATIBILITY | typeof HOLD_REMOTE_REBUILT;

export const syncHold = reactiveSource<SyncHoldReason | undefined>(undefined);

export interface SyncHoldPresentation {
    readonly text: string;
    readonly detail: string;
}

/** What the status bar says, and what its tooltip explains. */
export function describeSyncHold(reason: SyncHoldReason): SyncHoldPresentation {
    if (reason === HOLD_REMOTE_REBUILT) {
        return {
            text: "Sync held back",
            detail:
                "Another device replaced the files on the server, so this device's copy is out of date. " +
                'Run "Repair sync: replace files on this device" to take the server\'s version. ' +
                "Anything changed only here is kept as a second copy of the file.",
        };
    }
    return {
        text: "Sync held back",
        detail:
            "This device is running a different version from the one that last used this server. " +
            'Run "Review why synchronisation is paused" to see the details.',
    };
}
