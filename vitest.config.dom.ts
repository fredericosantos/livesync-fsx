/**
 * @file vitest.config.dom.ts
 * @description Tests that need a DOM and the browser build of Svelte: dialogue
 * mounting, and anything else that only fails once it is rendered. Kept apart
 * from the unit config because `resolve.conditions` changes how every import
 * resolves, and the unit suite must keep resolving to the Node builds.
 */
import { defineConfig, mergeConfig } from "vitest/config";
import viteConfig from "./vitest.config.common";

export default mergeConfig(
    viteConfig,
    defineConfig({
        resolve: {
            conditions: ["browser"],
        },
        test: {
            name: "dom-tests",
            environment: "happy-dom",
            include: ["**/*.dom.spec.ts"],
            exclude: ["node_modules/**"],
        },
    })
);
