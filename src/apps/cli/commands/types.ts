import { LiveSyncBaseCore } from "@/LiveSyncBaseCore";
import type { ObsidianLiveSyncSettings } from "@vrtmrz/livesync-commonlib/compat/common/types";
import type { NodeServiceContext } from "@/apps/cli/services/NodeServiceContext";

export type CLICommand =
    | "daemon"
    | "sync"
    | "push"
    | "pull"
    | "pull-rev"
    | "setup"
    | "put"
    | "cat"
    | "cat-rev"
    | "ls"
    | "info"
    | "rm"
    | "resolve"
    | "mirror"
    | "remote-add"
    | "remote-rm"
    | "remote-ls"
    | "remote-export"
    | "remote-set"
    | "remote-activate"
    | "mark-resolved"
    | "unlock-remote"
    | "lock-remote"
    | "remote-status"
    | "init-settings";

export interface CLIOptions {
    databasePath?: string;
    vaultPath?: string;
    settingsPath?: string;
    verbose?: boolean;
    debug?: boolean;
    force?: boolean;
    command: CLICommand;
    commandArgs: string[];
    interval?: number;
}

export interface CLICommandContext {
    databasePath: string;
    vaultPath: string;
    core: LiveSyncBaseCore<NodeServiceContext, never>;
    settingsPath: string;
    /**
     * What synchronisation was set to before the start-up scan suspended it.
     *
     * Seven keys once answered "when do we sync?", and this captured all of
     * them. Continuous replication is now the only mode there is, so there is
     * one switch to put back. It is still captured rather than assumed: the
     * daemon must restore what the settings file asked for, not what it hopes.
     */
    originalSyncSettings: Pick<ObsidianLiveSyncSettings, "liveSync">;
}

export const VALID_COMMANDS = new Set([
    "daemon",
    "sync",
    "push",
    "pull",
    "pull-rev",
    "setup",
    "put",
    "cat",
    "cat-rev",
    "ls",
    "info",
    "rm",
    "resolve",
    "mirror",
    "remote-add",
    "remote-rm",
    "remote-ls",
    "remote-export",
    "remote-set",
    "remote-activate",
    "mark-resolved",
    "unlock-remote",
    "lock-remote",
    "remote-status",
    "init-settings",
] as const);

export function isCLICommand(value: string): value is CLICommand {
    return (VALID_COMMANDS as ReadonlySet<string>).has(value);
}
