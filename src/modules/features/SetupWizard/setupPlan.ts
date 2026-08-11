/**
 * What setup is actually about to do, and how to say it.
 *
 * The previous flow asked the user to classify themselves — "new user" or
 * "existing user" — at the start, and then asked the same question again at the
 * end under different words. That question was never really about the person.
 * It was about the database: does the server already hold this vault, or not?
 *
 * The plugin can answer that itself by looking, so it does. This module turns
 * an observation of the remote and the local vault into the single sentence the
 * user has to agree with before anything is written.
 *
 * See `docs/fork/01-design-principles.md` (principles 7 and 8).
 */

export interface RemoteObservation {
    /** Whether the server answered at all with the supplied credentials. */
    readonly reachable: boolean;
    /** Why not, in the server's words, when it did not. */
    readonly unreachableReason?: string;
    /** LiveSync has initialised this database before. */
    readonly initialised: boolean;
    /** Documents already stored, when the server reported a count. */
    readonly documentCount?: number;
}

export interface LocalObservation {
    /** Files in this vault that are eligible for synchronisation. */
    readonly fileCount: number;
    /** Whether this vault was already synchronising before setup was opened. */
    readonly wasConfigured: boolean;
}

export const SETUP_UNREACHABLE = "unreachable";
/** The remote is empty: this vault's files become the first copy. */
export const SETUP_SEED = "seed";
/** The remote holds a vault: this device downloads it. */
export const SETUP_JOIN = "join";
/** Both sides already know each other: only the settings change. */
export const SETUP_RECONNECT = "reconnect";

export type SetupAction =
    | typeof SETUP_UNREACHABLE
    | typeof SETUP_SEED
    | typeof SETUP_JOIN
    | typeof SETUP_RECONNECT;

export interface SetupPlan {
    readonly action: SetupAction;
    /** What will happen, in one line. */
    readonly headline: string;
    /** The consequence the user is agreeing to. Never empty. */
    readonly detail: string;
    /** The button that commits. A verb, never "OK". */
    readonly confirmLabel: string;
    /**
     * Whether committing can lose local work. Drives the destructive styling;
     * see principle 7 — a destructive action must look like one.
     */
    readonly isDestructive: boolean;
}

/**
 * Whether a CouchDB database already holds a vault.
 *
 * By document count, never by size. A freshly created CouchDB database is not
 * zero bytes — it reports roughly 16 kB of its own bookkeeping — so a size test
 * calls every database initialised, makes {@link SETUP_SEED} unreachable, and
 * tells someone setting up their first device that they are joining a vault
 * that does not exist.
 */
export function isRemoteInitialised(status: false | { readonly doc_count?: number; readonly [key: string]: unknown }): boolean {
    if (status === false) return false;
    return (status.doc_count ?? 0) > 0;
}

function files(count: number): string {
    return count === 1 ? "1 file" : `${count} files`;
}

export function planSetup(remote: RemoteObservation, local: LocalObservation): SetupPlan {
    if (!remote.reachable) {
        return {
            action: SETUP_UNREACHABLE,
            headline: "The server did not answer",
            detail:
                remote.unreachableReason ??
                "Check the address, the username and the password, then try again. Nothing has been changed.",
            confirmLabel: "Back",
            isDestructive: false,
        };
    }

    if (!remote.initialised) {
        return {
            action: SETUP_SEED,
            headline: "Set up this vault on the server",
            detail: `${files(local.fileCount)} from this vault will be uploaded and become the copy that other devices download. Nothing on the server is overwritten, because there is nothing there yet.`,
            confirmLabel: "Upload this vault",
            isDestructive: false,
        };
    }

    if (local.wasConfigured) {
        return {
            action: SETUP_RECONNECT,
            headline: "Save the connection",
            detail: "Only the connection settings change. Your files are left alone on both sides.",
            confirmLabel: "Save connection",
            isDestructive: false,
        };
    }

    return {
        action: SETUP_JOIN,
        headline: "Download this vault from the server",
        detail:
            local.fileCount === 0
                ? "The server already holds a vault. It will be downloaded into this one."
                : `The server already holds a vault. It will be downloaded into this one, and the ${files(local.fileCount)} already here are kept: where the same file exists on both sides, the two versions are merged, and anything that cannot be merged is kept as a second copy.`,
        confirmLabel: "Download the vault",
        isDestructive: local.fileCount > 0,
    };
}
