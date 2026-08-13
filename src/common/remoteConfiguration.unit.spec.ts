import { describe, expect, it } from "vitest";
import type { ObsidianLiveSyncSettings } from "@vrtmrz/livesync-commonlib/compat/common/types";
import {
    SOLE_REMOTE_CONFIGURATION_ID,
    keepOnlyTheActiveRemoteConfiguration,
    soleRemoteConfigurationId,
} from "./remoteConfiguration.ts";

function profile(id: string, host: string) {
    return { id, name: `CouchDB ${host}`, uri: `sls+https://user:pass@${host}/?db=notes`, isEncrypted: false };
}

function settings(partial: Partial<ObsidianLiveSyncSettings>): Partial<ObsidianLiveSyncSettings> {
    return partial;
}

describe("soleRemoteConfigurationId", () => {
    it("reuses the id already in use, so reconfiguring replaces the stored server", () => {
        const stored = settings({
            remoteConfigurations: { "legacy-couchdb": profile("legacy-couchdb", "example.com") },
            activeConfigurationId: "legacy-couchdb",
        });
        expect(soleRemoteConfigurationId(stored)).toBe("legacy-couchdb");
    });

    it("falls back to the fixed id when nothing is stored yet", () => {
        expect(soleRemoteConfigurationId(settings({}))).toBe(SOLE_REMOTE_CONFIGURATION_ID);
    });

    // Otherwise setup would write into an id that does not exist while
    // `activeConfigurationId` still names a missing profile.
    it("ignores an active id that names no stored profile", () => {
        const stored = settings({ remoteConfigurations: {}, activeConfigurationId: "remote-gone" });
        expect(soleRemoteConfigurationId(stored)).toBe(SOLE_REMOTE_CONFIGURATION_ID);
    });
});

describe("keepOnlyTheActiveRemoteConfiguration", () => {
    it("discards the duplicates a repeated setup left behind", () => {
        const stored = settings({
            remoteConfigurations: {
                "remote-a": profile("remote-a", "couch.example"),
                "remote-b": profile("remote-b", "couch.example"),
                "remote-c": profile("remote-c", "couch.example"),
            },
            activeConfigurationId: "remote-c",
        });

        const repaired = keepOnlyTheActiveRemoteConfiguration(stored);

        expect(Object.keys(repaired.remoteConfigurations!)).toEqual(["remote-c"]);
        expect(repaired.activeConfigurationId).toBe("remote-c");
    });

    it("leaves a vault with one server, or none, exactly as it is", () => {
        const one = settings({
            remoteConfigurations: { couchdb: profile("couchdb", "couch.example") },
            activeConfigurationId: "couchdb",
        });
        expect(keepOnlyTheActiveRemoteConfiguration(one)).toBe(one);
        const none = settings({ remoteConfigurations: {}, activeConfigurationId: "" });
        expect(keepOnlyTheActiveRemoteConfiguration(none)).toBe(none);
    });

    // Losing the connection details entirely would mean a vault that has to be
    // set up again; keeping an arbitrary one of them means at worst a wrong
    // server that can be corrected from the settings page.
    it("keeps a profile when the active id is unreadable", () => {
        const stored = settings({
            remoteConfigurations: {
                "remote-a": profile("remote-a", "couch.example"),
                "remote-b": profile("remote-b", "couch.example"),
            },
            activeConfigurationId: "",
        });

        const repaired = keepOnlyTheActiveRemoteConfiguration(stored);

        expect(Object.keys(repaired.remoteConfigurations!)).toEqual(["remote-a"]);
        expect(repaired.activeConfigurationId).toBe("remote-a");
    });

    it("does not modify the settings it was given", () => {
        const stored = settings({
            remoteConfigurations: {
                "remote-a": profile("remote-a", "couch.example"),
                "remote-b": profile("remote-b", "couch.example"),
            },
            activeConfigurationId: "remote-b",
        });

        keepOnlyTheActiveRemoteConfiguration(stored);

        expect(Object.keys(stored.remoteConfigurations!)).toEqual(["remote-a", "remote-b"]);
    });
});
