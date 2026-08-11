/**
 * Maps synchronisation state onto what the user should actually see.
 *
 * The governing rule is that a working system shows nothing: when sync is
 * healthy and current, {@link presentStatus} returns an idle presentation whose
 * text is empty. Transient work is only surfaced once it has lasted long enough
 * to be worth reading, and anything requiring a decision outranks it.
 *
 * See `docs/fork/01-design-principles.md`.
 */

import { describeSyncHold, type SyncHoldReason } from "@/common/syncHold.ts";

export const STATUS_IDLE = "idle";
export const STATUS_ACTIVITY = "activity";
export const STATUS_ATTENTION = "attention";

export type StatusLevel = typeof STATUS_IDLE | typeof STATUS_ACTIVITY | typeof STATUS_ATTENTION;

/**
 * Minimum time work must be in flight before it is shown. Anything faster
 * would flash and disappear, which reads as noise rather than information.
 */
export const ACTIVITY_VISIBILITY_THRESHOLD_MS = 1_000;

export interface StatusInput {
    /** True once a remote connection has been established at least once. */
    connected: boolean;
    /** Replication is deliberately suspended. */
    paused: boolean;
    /** Replication stopped because of an error. */
    errored: boolean;
    /** Human-readable reason for {@link errored}, if one is known. */
    errorDetail?: string;
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
    /** A restart is required before settings take effect. */
    restartRequired: boolean;
    /** Synchronisation is held back for a reason the user can act on. */
    hold?: SyncHoldReason;
    /** Milliseconds the current burst of work has been in flight. */
    activeForMs: number;
}

export interface StatusPresentation {
    readonly level: StatusLevel;
    /**
     * Lucide icon name. Empty when idle — the status bar renders nothing at
     * all. The status bar is one icon, as Obsidian's own Sync does it: a
     * running count of documents is a progress bar for a process nobody asked
     * to watch, and it moves in the corner of the eye while you write.
     */
    readonly icon: string;
    /** What the icon means, in words. Empty when idle. Used as the tooltip. */
    readonly text: string;
    /** Longer explanation for the tooltip. Absent when idle. */
    readonly detail?: string;
}

/** Not syncing, and not because it is busy. */
const ICON_STOPPED = "refresh-cw-off";
/** Syncing right now. */
const ICON_WORKING = "refresh-cw";
/** Waiting on a person, not on the network. */
const ICON_DECIDE = "alert-circle";

const IDLE: StatusPresentation = { level: STATUS_IDLE, icon: "", text: "" };

function pluralise(count: number, singular: string, plural = `${singular}s`): string {
    return `${count} ${count === 1 ? singular : plural}`;
}

/**
 * Resolves the single thing worth showing, in strict priority order:
 * attention states first, then sustained activity, then silence.
 */
export function presentStatus(input: StatusInput): StatusPresentation {
    // --- Attention: something needs a human decision. Outranks all activity. ---
    if (input.restartRequired) {
        return {
            level: STATUS_ATTENTION,
            icon: ICON_DECIDE,
            text: "Restart required",
            detail: "Obsidian must be restarted before the new settings take effect.",
        };
    }
    if (input.hold) {
        return { level: STATUS_ATTENTION, icon: ICON_DECIDE, ...describeSyncHold(input.hold) };
    }
    if (input.conflicts > 0) {
        return {
            level: STATUS_ATTENTION,
            icon: ICON_DECIDE,
            text: pluralise(input.conflicts, "conflict"),
            detail: "The same file was edited on more than one device. Select which version to keep.",
        };
    }
    if (input.errored) {
        return {
            level: STATUS_ATTENTION,
            icon: ICON_STOPPED,
            text: "Sync error",
            detail: input.errorDetail ?? "Synchronisation stopped because of an error.",
        };
    }
    if (input.paused) {
        return {
            level: STATUS_ATTENTION,
            icon: ICON_STOPPED,
            text: "Sync paused",
            detail: "Synchronisation is suspended. Resume it from the settings pane.",
        };
    }
    if (!input.connected) {
        // Not an error on its own — the remote may simply be unreachable right now.
        return {
            level: STATUS_ATTENTION,
            icon: ICON_STOPPED,
            text: "Not connected",
            detail: "No connection to the remote server.",
        };
    }

    // --- Activity: real work, but only once it has lasted long enough to read. ---
    if (input.activeForMs < ACTIVITY_VISIBILITY_THRESHOLD_MS) return IDLE;

    const upload = Math.max(0, input.pendingUpload);
    const download = Math.max(0, input.pendingDownload);
    const local = Math.max(0, input.processing) + Math.max(0, input.queued);

    if (upload > 0 && download > 0) {
        return {
            level: STATUS_ACTIVITY,
            icon: ICON_WORKING,
            text: `Syncing ${upload + download} changes`,
            detail: `Uploading ${pluralise(upload, "change")}, downloading ${download}.`,
        };
    }
    if (upload > 0) {
        return {
            level: STATUS_ACTIVITY,
            icon: ICON_WORKING,
            text: `Uploading ${upload}`,
            detail: `Sending ${pluralise(upload, "change")} to the remote server.`,
        };
    }
    if (download > 0) {
        return {
            level: STATUS_ACTIVITY,
            icon: ICON_WORKING,
            text: `Downloading ${download}`,
            detail: `Receiving ${pluralise(download, "change")} from the remote server.`,
        };
    }
    if (local > 0) {
        return {
            level: STATUS_ACTIVITY,
            icon: ICON_WORKING,
            text: `Processing ${local}`,
            detail: `Reading or writing ${pluralise(local, "file")}.`,
        };
    }

    // Connected, current, nothing in flight. Show nothing.
    return IDLE;
}
