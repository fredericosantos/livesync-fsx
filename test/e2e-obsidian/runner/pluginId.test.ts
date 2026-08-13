import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { PLUGIN_ID } from "./pluginId.ts";

const harnessRoot = fileURLToPath(new URL("..", import.meta.url));

function typeScriptFiles(directory: string): string[] {
    return readdirSync(directory).flatMap((entry) => {
        const path = join(directory, entry);
        if (statSync(path).isDirectory()) return typeScriptFiles(path);
        return path.endsWith(".ts") ? [path] : [];
    });
}

describe("the harness targets the plug-in it builds", () => {
    it("takes its id from the manifest", () => {
        expect(PLUGIN_ID).toBe("livesync-fsx");
    });

    // The id appears inside `app.plugins.plugins[...]` lookups evaluated in
    // Obsidian, where a wrong one yields `undefined` rather than an error, and
    // the failure surfaces far from its cause. Cheaper to fail here.
    it("never names the upstream plug-in", () => {
        const offenders = typeScriptFiles(harnessRoot)
            .filter((path) => !path.endsWith("pluginId.test.ts"))
            .filter((path) => readFileSync(path, "utf8").includes("obsidian-livesync"));
        expect(offenders).toEqual([]);
    });
});
