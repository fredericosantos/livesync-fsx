/**
 * The whole of what synchronisation says about itself: one icon.
 *
 * This used to be a status bar plus two hundred and twenty toasts. The toasts
 * are gone — every one of them, including the successes — because a message
 * that interrupts you to say a thing worked is a message you have to dismiss to
 * get back to writing. What is left is four states, in one corner:
 *
 *   offline   nothing is reaching the server
 *   syncing   work in flight, the icon turns
 *   synced    it just finished, briefly, in green
 *   problem   something is wrong, in red — press it to find out what
 *
 * Everything the toasts used to say is still in the log, and the log is one
 * click away on the icon. The difference is who chooses when to read it.
 *
 * See `docs/fork/01-design-principles.md`.
 */

import { describeSyncHold, type SyncHoldReason } from "@/common/syncHold.ts";

export const STATUS_IDLE = "idle";
export const STATUS_SYNCING = "syncing";
export const STATUS_SYNCED = "synced";
export const STATUS_OFFLINE = "offline";
export const STATUS_PROBLEM = "problem";

export type StatusLevel =
    | typeof STATUS_IDLE
    | typeof STATUS_SYNCING
    | typeof STATUS_SYNCED
    | typeof STATUS_OFFLINE
    | typeof STATUS_PROBLEM;

/**
 * Minimum time work must be in flight before the icon appears. Anything faster
 * would flash and vanish, which reads as a glitch rather than as information.
 */
export const ACTIVITY_VISIBILITY_THRESHOLD_MS = 1_000;

/**
 * How long the green tick stays after work finishes.
 *
 * Long enough to be seen if you happened to be looking, short enough that it is
 * never the reason the corner of your eye moves twice.
 */
export const SYNCED_VISIBILITY_MS = 2_000;

export interface StatusInput {
    /** True once a remote connection has been established at least once. */
    connected: boolean;
    /**
     * At least one thing is set to cause replication. When nothing is, "not
     * connected" says the wrong thing: no connection was attempted, and none
     * ever will be.
     */
    anyTriggerEnabled: boolean;
    /** Replication is deliberately suspended. */
    paused: boolean;
    /** Replication stopped because of an error. */
    errored: boolean;
    /**
     * The most recent thing that went wrong, in the words it was logged in.
     *
     * This is what the icon turns red about, and what it shows when pressed.
     * It arrives from the log rather than from replication state, because most
     * failures — a file that could not be written, a chunk that could not be
     * decrypted — never stop replication at all, and used to be reported only
     * by a toast that has now gone.
     */
    problem?: string;
    /** Documents still to send. */
    pendingUpload: number;
    /** Documents still to receive. */
    pendingDownload: number;
    /** Files being read or written locally. */
    processing: number;
    /** Files waiting to be processed. */
    queued: number;
    /** Unresolved conflicts awaiting a decision. */
    conflicts: number;
    /**
     * Settings changed on two devices in a way that cannot be merged.
     *
     * Counted apart from `conflicts`, which is notes. The wording differs —
     * nobody thinks of their hotkeys as a file — and so does the remedy: this
     * one is answered by choosing a device, not by reading two versions of a
     * note and deciding what you meant.
     */
    settingsDecisions?: number;
    /** A restart is required before settings take effect. */
    restartRequired: boolean;
    /**
     * Obsidian's own preferences arrived from another device.
     *
     * Obsidian reads them once, when it opens, so nothing but a restart applies
     * them — and a restart takes the window away, which makes it the reader's
     * decision rather than a replication's. It waits here.
     */
    restartToApplySettings?: boolean;
    /** Synchronisation is held back for a reason the user can act on. */
    hold?: SyncHoldReason;
    /** Milliseconds the current burst of work has been in flight. */
    activeForMs: number;
    /**
     * Milliseconds since the last burst of work finished, or undefined if none
     * has finished since start-up. Drives the green tick.
     */
    sinceSyncedMs?: number;
}

export interface StatusPresentation {
    readonly level: StatusLevel;
    /** Lucide icon name. Empty when idle — the status bar renders nothing. */
    readonly icon: string;
    /** What the icon means, in words. Empty when idle. Used as the tooltip. */
    readonly text: string;
    /** Longer explanation for the tooltip. Absent when idle. */
    readonly detail?: string;
}

/** Nothing is reaching the server. */
const ICON_OFFLINE = "refresh-cw-off";
/** Work in flight. Spun by CSS. */
const ICON_SYNCING = "refresh-cw";
/** Just finished. */
const ICON_SYNCED = "check";
/** Something is wrong, or a decision is owed. */
const ICON_PROBLEM = "alert-circle";

const IDLE: StatusPresentation = { level: STATUS_IDLE, icon: "", text: "" };

function pluralise(count: number, singular: string, plural = `${singular}s`): string {
    return `${count} ${count === 1 ? singular : plural}`;
}

function problem(text: string, detail: string): StatusPresentation {
    return { level: STATUS_PROBLEM, icon: ICON_PROBLEM, text, detail };
}

/**
 * Resolves the single thing worth showing, in strict priority order: anything
 * wrong, then work in flight, then the moment after it, then silence.
 */
export function presentStatus(input: StatusInput): StatusPresentation {
    // --- Red. Something is wrong or a decision is owed. ---
    if (input.restartRequired) {
        return problem("Restart required", "Obsidian must be restarted before the new settings take effect.");
    }
    if (input.restartToApplySettings) {
        return problem(
            "Restart to apply settings",
            "Obsidian's own settings arrived from another device. It reads them when it opens, so they take effect after a restart. Nothing is lost by waiting."
        );
    }
    if (input.hold) {
        const held = describeSyncHold(input.hold);
        return problem(held.text, held.detail);
    }
    if (input.conflicts > 0) {
        return problem(
            pluralise(input.conflicts, "conflict"),
            "The same file was edited on more than one device. Select which version to keep."
        );
    }
    if (input.settingsDecisions) {
        return problem(
            input.settingsDecisions === 1
                ? "A setting needs a decision"
                : `${input.settingsDecisions} settings need a decision`,
            "The same setting was changed on two devices and the two changes cannot both be kept. Press to choose."
        );
    }
    if (input.errored) {
        return problem("Sync error", input.problem ?? "Synchronisation stopped because of an error.");
    }
    if (input.problem) {
        // Replication is still running: something failed inside it. Red is
        // still right — it is the only thing that will ever mention this.
        return problem("Something went wrong", input.problem);
    }
    if (input.paused) {
        return problem("Sync paused", "Synchronisation is suspended. Resume it from the settings pane.");
    }
    if (!input.anyTriggerEnabled) {
        return problem(
            "Sync is switched off",
            "This vault is connected to a server, but nothing is set to synchronise with it."
        );
    }

    // --- Grey. Not an error: the server may simply be unreachable. ---
    if (!input.connected) {
        // No detail. "Not connected" over "No connection to the remote
        // server." is the same sentence twice, and a tooltip that restates its
        // own heading teaches the reader that the second line is never worth
        // reading — including on the states where it says something.
        return { level: STATUS_OFFLINE, icon: ICON_OFFLINE, text: "Not connected" };
    }

    // --- Turning. Real work, once it has lasted long enough to read. ---
    const upload = Math.max(0, input.pendingUpload);
    const download = Math.max(0, input.pendingDownload);
    const local = Math.max(0, input.processing) + Math.max(0, input.queued);
    const busy = upload + download + local > 0;

    if (busy && input.activeForMs >= ACTIVITY_VISIBILITY_THRESHOLD_MS) {
        const text =
            upload > 0 && download > 0
                ? `Syncing ${upload + download} changes`
                : upload > 0
                  ? `Uploading ${upload}`
                  : download > 0
                    ? `Downloading ${download}`
                    : `Processing ${local}`;
        return { level: STATUS_SYNCING, icon: ICON_SYNCING, text, detail: "Synchronising with the server." };
    }

    // --- Green, briefly. It just finished. ---
    if (!busy && input.sinceSyncedMs !== undefined && input.sinceSyncedMs < SYNCED_VISIBILITY_MS) {
        return { level: STATUS_SYNCED, icon: ICON_SYNCED, text: "Synced", detail: "Everything is up to date." };
    }

    // Connected, current, nothing in flight. Show nothing.
    return IDLE;
}
