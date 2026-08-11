import type {
    ObsidianLiveSyncSettings,
    RemoteDBSettings,
} from "@vrtmrz/livesync-commonlib/compat/common/models/setting.type";

export type CouchDBConnectionProbeResult = { ok: true } | { ok: false; reason: string };

type CouchDBConnectionResult =
    | string
    | {
          db: unknown;
          info: unknown;
      };

export interface CouchDBConnectionProbe {
    isMobile(): boolean;
    connectRemoteCouchDBWithSetting(
        settings: RemoteDBSettings,
        isMobile: boolean,
        performSetup: boolean,
        skipInfo: boolean
    ): CouchDBConnectionResult | Promise<CouchDBConnectionResult>;
}

export function isCouchDBConnectionProbe(value: unknown): value is CouchDBConnectionProbe {
    return (
        typeof value === "object" &&
        value !== null &&
        "isMobile" in value &&
        typeof value.isMobile === "function" &&
        "connectRemoteCouchDBWithSetting" in value &&
        typeof value.connectRemoteCouchDBWithSetting === "function"
    );
}

export async function probeCouchDBConnection(
    replicator: unknown,
    settings: ObsidianLiveSyncSettings,
    createIfMissing: boolean
): Promise<CouchDBConnectionProbeResult> {
    if (!isCouchDBConnectionProbe(replicator)) {
        return { ok: false, reason: "The CouchDB connection probe is unavailable." };
    }
    const result = await replicator.connectRemoteCouchDBWithSetting(
        settings,
        replicator.isMobile(),
        createIfMissing,
        false
    );
    if (typeof result === "string") {
        return { ok: false, reason: result };
    }
    return { ok: true };
}

/**
 * Turns a connection failure into something the reader can act on.
 *
 * A browser refuses a cross-origin request before the server ever sees it, and
 * reports it as an ordinary network error — indistinguishable, to the reader,
 * from a server that is switched off. The old dialogue answered this with a
 * "Use Internal API" checkbox, which asked the user to know what CORS is and to
 * choose a non-standard transport to work around a server they can fix.
 */
export function explainConnectionFailure(reason: string): string {
    const looksLikeBrowserRefusal = /failed to fetch|networkerror|load failed|cors/i.test(reason);
    if (!looksLikeBrowserRefusal) return reason;
    return (
        `${reason}\n\n` +
        "If the server works in a browser, it is probably refusing the request because it does not " +
        "allow Obsidian as an origin. In CouchDB's configuration, enable CORS and list " +
        "app://obsidian.md, and capacitor://localhost for mobile."
    );
}

export function isValidCouchDBServerURL(value: string): boolean {
    try {
        const url = new URL(value);
        return (url.protocol === "http:" || url.protocol === "https:") && url.hostname !== "";
    } catch {
        return false;
    }
}
