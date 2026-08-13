/**
 * The plug-in id, read from the manifest rather than written down.
 *
 * It was written down — as upstream's id — in a hundred places across this
 * harness, and stayed there after the fork took an id of its own.
 * The harness went on installing into, and looking up, a plug-in that is not the
 * one under test. `pluginId.test.ts` fails if these two ever part company again.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const manifestPath = fileURLToPath(new URL("../../../manifest.json", import.meta.url));

export const PLUGIN_ID: string = JSON.parse(readFileSync(manifestPath, "utf8")).id;
