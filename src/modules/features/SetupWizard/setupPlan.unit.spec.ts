import { describe, expect, it } from "vitest";
import {
    SETUP_JOIN,
    SETUP_RECONNECT,
    SETUP_SEED,
    SETUP_UNREACHABLE,
    isRemoteInitialised,
    planSetup,
    type LocalObservation,
    type RemoteObservation,
} from "./setupPlan.ts";

const remote = (over: Partial<RemoteObservation> = {}): RemoteObservation => ({
    reachable: true,
    initialised: true,
    ...over,
});
const local = (over: Partial<LocalObservation> = {}): LocalObservation => ({
    fileCount: 0,
    wasConfigured: false,
    ...over,
});

describe("planSetup", () => {
    it("stops at an unreachable server without proposing anything", () => {
        const plan = planSetup(remote({ reachable: false, unreachableReason: "401 Unauthorized" }), local());
        expect(plan.action).toBe(SETUP_UNREACHABLE);
        expect(plan.detail).toContain("401 Unauthorized");
    });

    it("seeds an empty server from the local vault", () => {
        const plan = planSetup(remote({ initialised: false }), local({ fileCount: 653 }));
        expect(plan.action).toBe(SETUP_SEED);
        expect(plan.detail).toContain("653 files");
    });

    it("joins an initialised server, reporting what is already there", () => {
        const plan = planSetup(remote({ documentCount: 653 }), local());
        expect(plan.action).toBe(SETUP_JOIN);
        expect(plan.headline).toContain("653 files");
    });

    it("only changes settings when this vault was already synchronising", () => {
        const plan = planSetup(remote(), local({ fileCount: 653, wasConfigured: true }));
        expect(plan.action).toBe(SETUP_RECONNECT);
        expect(plan.isDestructive).toBe(false);
    });

    describe("warning about local work", () => {
        it("marks joining destructive when the vault is not empty", () => {
            // The files survive, but they collide, and the user must be told
            // before they agree rather than discover it afterwards.
            const plan = planSetup(remote(), local({ fileCount: 12 }));
            expect(plan.isDestructive).toBe(true);
            expect(plan.detail).toContain("merged");
            expect(plan.detail).toContain("12 files");
        });

        it("does not warn when there is nothing to lose", () => {
            const plan = planSetup(remote(), local({ fileCount: 0 }));
            expect(plan.isDestructive).toBe(false);
            expect(plan.detail).not.toContain("merged");
        });
    });

    describe("wording", () => {
        it("singularises a lone file on both sides", () => {
            expect(planSetup(remote({ initialised: false }), local({ fileCount: 1 })).detail).toContain("1 file from");
            expect(planSetup(remote({ documentCount: 1 }), local()).headline).toContain("1 file");
        });

        it("stays vague rather than wrong when the server reports no count", () => {
            const plan = planSetup(remote({ documentCount: undefined }), local());
            expect(plan.headline).toBe("The server already holds a vault.");
        });

        it("labels every button with the verb it performs", () => {
            const plans = [
                planSetup(remote({ initialised: false }), local()),
                planSetup(remote(), local()),
                planSetup(remote(), local({ wasConfigured: true })),
            ];
            for (const plan of plans) {
                expect(plan.confirmLabel).not.toBe("OK");
                expect(plan.detail.length).toBeGreaterThan(0);
            }
        });
    });
});

describe("isRemoteInitialised", () => {
    it("treats a freshly created database as empty despite its size", () => {
        // What CouchDB actually reports for a database created seconds ago and
        // never written to. Reading `sizes.file` here made every setup look
        // like joining an existing vault.
        expect(isRemoteInitialised({ doc_count: 0, sizes: { file: 16692, active: 0, external: 0 } })).toBe(false);
    });

    it("treats a database holding documents as initialised", () => {
        expect(isRemoteInitialised({ doc_count: 35301, sizes: { file: 310956472 } })).toBe(true);
    });

    it("treats an unanswered status as empty rather than guessing", () => {
        expect(isRemoteInitialised(false)).toBe(false);
        expect(isRemoteInitialised({})).toBe(false);
    });
});
