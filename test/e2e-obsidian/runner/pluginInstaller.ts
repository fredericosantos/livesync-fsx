import {
    installBuiltPlugin as installGenericBuiltPlugin,
    type PluginInstallResult,
} from "@vrtmrz/obsidian-test-session";
import { PLUGIN_ID } from "./pluginId.ts";

export type { PluginInstallResult };

export async function installBuiltPlugin(vaultPath: string, rootDir = process.cwd()): Promise<PluginInstallResult> {
    return await installGenericBuiltPlugin(vaultPath, {
        pluginId: PLUGIN_ID,
        artifactRoot: rootDir,
    });
}
