import { ConnectionStringParser } from "@vrtmrz/livesync-commonlib/compat/common/ConnectionString";
import {
    REMOTE_P2P,
    type ObsidianLiveSyncSettings,
} from "@vrtmrz/livesync-commonlib/compat/common/types";

/**
 * A vault here syncs with one server, so it stores one server profile.
 *
 * Upstream supports several — CouchDB, Object Storage, P2P, a work server and a
 * home server — and allocates a fresh opaque id every time one is saved, keeping
 * all the previous ones. Setup saved without an id, so *every* run of it left
 * another profile behind: three on one test vault, two on a phone, all pointing
 * at the same server. The only visible symptom was a dialogue asking which of
 * two identical servers to fetch from, at the one moment the answer matters.
 *
 * The id used when there is nothing to reuse. Opaque ids exist so that two
 * profiles cannot collide; with one profile there is nothing to collide with,
 * and a name that says what it is beats `remote-msp9pzhj-488e5m`.
 */
export const SOLE_REMOTE_CONFIGURATION_ID = "couchdb";

/**
 * The id setup should write to: the one already in use, or the fixed one.
 *
 * Reusing the active id keeps a device's stored profile continuous across a
 * reconfiguration, including the `legacy-couchdb` id given to profiles migrated
 * from before profiles existed.
 */
export function soleRemoteConfigurationId(settings: Partial<ObsidianLiveSyncSettings>): string {
    const activeId = settings.activeConfigurationId?.trim();
    if (activeId && settings.remoteConfigurations?.[activeId]) return activeId;
    return SOLE_REMOTE_CONFIGURATION_ID;
}

/**
 * Discards every server profile but the one in use.
 *
 * Applied when settings are loaded and when setup saves, so a vault that has
 * already accumulated duplicates repairs itself without being asked to. What is
 * discarded is a stale copy of the connection details, not a connection: the
 * active profile is the one every part of the plug-in reads.
 */
export function keepOnlyTheActiveRemoteConfiguration<T extends Partial<ObsidianLiveSyncSettings>>(settings: T): T {
    const configurations = settings.remoteConfigurations ?? {};
    const ids = Object.keys(configurations);
    if (ids.length <= 1) return settings;

    const activeId = settings.activeConfigurationId?.trim();
    // Falling back to the first is arbitrary, but an unreadable
    // `activeConfigurationId` is already a broken state, and keeping a profile
    // beats keeping none.
    const survivorId = activeId && configurations[activeId] ? activeId : ids[0];
    return {
        ...settings,
        remoteConfigurations: { [survivorId]: configurations[survivorId] },
        activeConfigurationId: survivorId,
    };
}

/** Returns whether the selected main remote represents the P2P-only setup. */
export function isP2PMainRemote(settings: ObsidianLiveSyncSettings): boolean {
    if (settings.remoteType === REMOTE_P2P) return true;

    const activeId = settings.activeConfigurationId?.trim();
    const activeConfiguration = activeId ? settings.remoteConfigurations?.[activeId] : undefined;
    if (!activeConfiguration) return false;

    try {
        return ConnectionStringParser.parse(activeConfiguration.uri).type === "p2p";
    } catch {
        return false;
    }
}
