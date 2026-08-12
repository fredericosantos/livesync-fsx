import { describe, expect, it, vi } from "vitest";
import type { CompatibilityPause } from "@/common/databaseCompatibility.ts";
import { compatibilityReviewDetailsMarkdown } from "./compatibilityReviewMarkdown.ts";
import { ObsidianCompatibilityReviewUi } from "./compatibilityReviewObsidian.ts";

vi.mock("@/deps.ts", () => ({
    Notice: class {
        hide() {}
    },
}));

const resumablePause: CompatibilityPause = {
    resumable: true,
    reasons: [
        {
            source: "database-version",
            state: "upgrade",
            acknowledgedVersion: 11,
            currentVersion: 12,
            resumable: true,
        },
    ],
};

describe("Obsidian compatibility review", () => {
    it("explains why a configured Vault can be missing its device-local acknowledgement", async () => {
        const pause: CompatibilityPause = {
            resumable: true,
            reasons: [
                {
                    source: "database-version",
                    state: "missing",
                    currentVersion: 12,
                    resumable: true,
                },
            ],
        };

        const details = compatibilityReviewDetailsMarkdown(pause);
        expect(details).toContain("copied or restored");
        expect(details).toContain("new Obsidian profile");
        expect(details).toContain("does not mean that it is safe to resume automatically");
    });

    it("offers the generic resume action in a vertical action dialogue", async () => {
        const confirmWithMessage = vi.fn().mockResolvedValue("Resume syncing");
        const ui = new ObsidianCompatibilityReviewUi({ confirmWithMessage } as never);

        await expect(ui.showSummary(resumablePause)).resolves.toBe("resume");
        // A title names the state; the buttons name their verbs. A title
        // starting "Why…" withholds its own answer to earn a click, which is
        // not a thing to do to someone who did not ask to be interrupted.
        expect(confirmWithMessage).toHaveBeenCalledWith(
            "Sync paused",
            expect.any(String),
            ["Show details", "Resume syncing", "Leave it paused"],
            "Leave it paused",
            undefined,
            "vertical"
        );
    });
});
