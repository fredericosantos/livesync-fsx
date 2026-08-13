import {
    createTemporaryVault as createGenericTemporaryVault,
    type TemporaryVault,
} from "@vrtmrz/obsidian-test-session";
import { PLUGIN_ID } from "./pluginId.ts";

export type { TemporaryVault };

export async function createTemporaryVault(prefix = "livesync-fsx-e2e-"): Promise<TemporaryVault> {
    return await createGenericTemporaryVault({
        prefix,
        pluginIds: [PLUGIN_ID],
        idPrefix: "livesync-e2e",
    });
}
