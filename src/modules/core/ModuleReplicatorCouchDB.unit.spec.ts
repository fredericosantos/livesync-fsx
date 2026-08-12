import { describe, expect, it, vi } from "vitest";
import { ModuleReplicatorCouchDB } from "./ModuleReplicatorCouchDB.ts";

function createModule(settings: { liveSync: boolean }, isReplicationReady = true) {
    const openReplication = vi.fn(async () => true);
    const runFiniteReplicationActivity = vi.fn(async (task: () => unknown) => await task());
    const services = {
        API: {
            addLog: vi.fn(),
            addCommand: vi.fn(),
            registerWindow: vi.fn(),
            addRibbonIcon: vi.fn(),
            registerProtocolHandler: vi.fn(),
        },
        appLifecycle: {
            isSuspended: vi.fn(() => false),
            isReady: vi.fn(() => true),
        },
        replication: {
            isReplicationReady: vi.fn(async () => isReplicationReady),
        },
        replicator: {
            runFiniteReplicationActivity,
        },
        setting: {
            saveSettingData: vi.fn(async () => undefined),
        },
    };
    const core = {
        _services: services,
        services,
        settings: {
            remoteType: "",
            ...settings,
        },
        replicator: { openReplication },
    } as any;
    return {
        module: new ModuleReplicatorCouchDB(core),
        openReplication,
        runFiniteReplicationActivity,
    };
}

describe("ModuleReplicatorCouchDB resume replication activity", () => {
    // The "start-up one-shot" this used to test was the `syncOnStart` mode:
    // connect once when Obsidian opens, then stay quiet for the session. There
    // is one way to replicate now, and it is continuous.
    it("opens the continuous channel, unwrapped by any finite activity", async () => {
        const { module, openReplication, runFiniteReplicationActivity } = createModule({
            liveSync: true,
        });

        await module._everyAfterResumeProcess();

        await vi.waitFor(() => expect(openReplication).toHaveBeenCalledOnce());
        expect(runFiniteReplicationActivity).not.toHaveBeenCalled();
        expect(openReplication).toHaveBeenCalledWith(expect.any(Object), true, false, false);
    });

    it("opens nothing while replication is switched off", async () => {
        const { module, openReplication } = createModule({ liveSync: false });

        await module._everyAfterResumeProcess();
        await new Promise((resolve) => setTimeout(resolve, 0));

        expect(openReplication).not.toHaveBeenCalled();
    });

    it("opens nothing when start-up readiness fails", async () => {
        const { module, openReplication } = createModule({ liveSync: true }, false);

        await module._everyAfterResumeProcess();
        await new Promise((resolve) => setTimeout(resolve, 0));

        expect(openReplication).not.toHaveBeenCalled();
    });
});
