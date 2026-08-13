import { describe, expect, it, vi } from "vitest";

vi.mock("@/modules/features/SetupManager.ts", () => ({
    SetupManager: class SetupManager {},
}));
vi.mock("@/deps.ts", () => ({}));
vi.mock("@/common/utils.ts", () => ({
    isValidPath: () => true,
}));

import { ModuleMigration } from "./ModuleMigration.ts";

async function* noDocuments() {
    return;
}

async function* failedDocumentScan() {
    throw new Error("scan failed");
}

function createMigration(findAllNormalDocs: typeof noDocuments | typeof failedDocumentScan = noDocuments) {
    const noticeGroups = {
        setItem: vi.fn(),
        finish: vi.fn(() => true),
    };
    const services = {
        API: {
            addLog: vi.fn(),
            addCommand: vi.fn(),
            registerWindow: vi.fn(),
            addRibbonIcon: vi.fn(),
            registerProtocolHandler: vi.fn(),
        },
        context: { noticeGroups },
        vault: { isTargetFile: vi.fn(async () => true) },
        path: { getPath: vi.fn() },
    };
    const core = {
        _services: services,
        services,
        kvDB: {
            get: vi.fn(async () => false),
            set: vi.fn(async () => undefined),
        },
        localDatabase: { findAllNormalDocs },
        storageAccess: {},
    };
    return {
        migration: new ModuleMigration(core as never),
        noticeGroups,
    };
}

describe("ModuleMigration incomplete-document notice", () => {
    // This check runs once per vault at start-up and almost always finds
    // nothing. It used to say so twice — "Checking for incomplete documents…",
    // then "No size mismatches found" — two interruptions reporting that
    // nothing happened.
    it("says nothing at all when the scan finds nothing", async () => {
        const { migration, noticeGroups } = createMigration();

        await expect(migration.hasIncompleteDocs()).resolves.toBe(true);

        expect(noticeGroups.setItem).not.toHaveBeenCalled();
    });

    it("finishes the group with a failure result when the scan throws", async () => {
        const { migration, noticeGroups } = createMigration(failedDocumentScan);

        await expect(migration.hasIncompleteDocs()).rejects.toThrow("scan failed");

        expect(noticeGroups.setItem).toHaveBeenLastCalledWith("startup-integrity-check", "result", {
            message: "The incomplete document check could not be completed.",
        });
        expect(noticeGroups.finish).toHaveBeenCalledWith("startup-integrity-check");
    });
});
