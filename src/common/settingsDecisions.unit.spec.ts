import { beforeEach, describe, expect, it, vi } from "vitest";
import {
    addSettingsDecision,
    nextSettingsDecision,
    removeSettingsDecision,
    settingsDecisions,
} from "./settingsDecisions.ts";

const decision = (path: string) => ({ path, ask: () => Promise.resolve() });

describe("settingsDecisions", () => {
    beforeEach(() => {
        settingsDecisions.value = [];
    });

    it("counts one unresolved file once, however often it is requeued", () => {
        // The conflict check is requeued after each resolution, so a file that
        // is still conflicted comes back round. Appending would make the icon
        // report two decisions, then three, for one file.
        addSettingsDecision(decision(".obsidian/plugins/iconic/data.json"));
        addSettingsDecision(decision(".obsidian/plugins/iconic/data.json"));
        expect(settingsDecisions.value).toHaveLength(1);
    });

    it("keeps distinct files apart", () => {
        addSettingsDecision(decision("a.json"));
        addSettingsDecision(decision("b.json"));
        expect(settingsDecisions.value).toHaveLength(2);
        removeSettingsDecision("a.json");
        expect(nextSettingsDecision()?.path).toBe("b.json");
    });

    it("does not notify observers when removing something that was not there", () => {
        // One of those observers redraws the status bar.
        addSettingsDecision(decision("a.json"));
        const seen = vi.fn();
        settingsDecisions.onChanged(seen);
        removeSettingsDecision("never-added.json");
        expect(seen).not.toHaveBeenCalled();
    });

    it("has nothing to ask about when empty", () => {
        expect(nextSettingsDecision()).toBeUndefined();
    });
});
