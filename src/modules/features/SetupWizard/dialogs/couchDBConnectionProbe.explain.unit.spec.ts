import { describe, expect, it } from "vitest";
import { explainConnectionFailure } from "./couchDBConnectionProbe";

describe("explainConnectionFailure", () => {
    it.each([
        "TypeError: Failed to fetch",
        "NetworkError when attempting to fetch resource.",
        "Load failed",
        "Blocked by CORS policy",
    ])("names the origin allow-list for %s", (reason) => {
        const explained = explainConnectionFailure(reason);
        expect(explained).toContain(reason);
        expect(explained).toContain("app://obsidian.md");
    });

    it.each(["Name or password is incorrect.", "unauthorized", "Database not found."])("leaves %s alone", (reason) => {
        expect(explainConnectionFailure(reason)).toBe(reason);
    });
});
