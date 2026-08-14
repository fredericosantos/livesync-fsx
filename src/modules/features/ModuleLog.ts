import { computed, reactive, reactiveSource, type ReactiveValue } from "octagonal-wheels/dataobject/reactive";
import {
    LOG_LEVEL_DEBUG,
    LOG_LEVEL_INFO,
    LOG_LEVEL_VERBOSE,
    PREFIXMD_LOGFILE,
    type LOG_LEVEL,
} from "@vrtmrz/livesync-commonlib/compat/common/types";
import { type LogEntry, logMessages } from "@vrtmrz/livesync-commonlib/compat/mock_and_interop/stores";
import { scheduleTask } from "octagonal-wheels/concurrency/task";
import { fireAndForget, isDirty, throttle } from "@vrtmrz/livesync-commonlib/compat/common/utils";
import { AbstractObsidianModule } from "@/modules/AbstractObsidianModule.ts";
import { debounce, normalizePath, Notice, setIcon, stringifyYaml, type WorkspaceLeaf } from "@/deps.ts";
import { LOG_LEVEL_NOTICE, setGlobalLogFunction } from "octagonal-wheels/common/logger";
import { isProblem } from "@/common/noticePolicy.ts";
import { LogPaneView, VIEW_TYPE_LOG } from "./Log/LogPaneView.ts";
import { serialized } from "octagonal-wheels/concurrency/lock";
import { P2PLogCollector } from "@vrtmrz/livesync-commonlib/compat/replication/trystero/P2PLogCollector";
import {
    STATUS_OFFLINE,
    STATUS_PROBLEM,
    STATUS_SYNCED,
    STATUS_SYNCING,
    SYNCED_VISIBILITY_MS,
    presentStatus,
    type StatusLevel,
} from "./StatusPresentation.ts";
import { syncHold } from "@/common/syncHold.ts";
import { restartToApplySettings } from "@/common/pendingRestart.ts";
import { nextSettingsDecision, settingsDecisions } from "@/common/settingsDecisions.ts";
import type { LiveSyncCore } from "@/main.ts";
import { LiveSyncError } from "@vrtmrz/livesync-commonlib/compat/common/LSError";
import { compatGlobal } from "@vrtmrz/livesync-commonlib/compat/common/coreEnvFunctions";
import { generateReport } from "@/common/reportTool.ts";

// This module cannot be a core module because it depends on the Obsidian UI.

// DI the log again.
const recentLogEntries = reactiveSource<LogEntry[]>([]);
const globalLogFunction = (message: unknown, level?: number, key?: string) => {
    const messageX =
        message instanceof Error
            ? new LiveSyncError("[Error Logged]: " + message.message, { cause: message })
            : typeof message === "string"
              ? message
              : JSON.stringify(message);
    const entry = { message: messageX, level, key } as LogEntry;
    recentLogEntries.value = [...recentLogEntries.value, entry];
};

setGlobalLogFunction(globalLogFunction);
// Keep the recent logs in memory for display, but also keep a longer history in logForDump for when the user wants to see more logs.
// logForDump is not reactive and is only used for dumping logs when requested, while recentLogs is reactive and is used for displaying logs in the UI.
const logForDump = [] as string[];

function addLog(log: string) {
    logForDump.push(log);
    while (logForDump.length > 1000) {
        logForDump.shift();
    }
}

// Display log is kept separate from the full log history to optimize performance and memory usage.
// And debounce the updates to the display log to avoid excessive UI updates when there are many log entries in a short time.
const logForDisplay = [] as string[];

const updateLogMessage = debounce(() => {
    logMessages.value = [...logForDisplay];
}, 25);
function addDisplayLog(log: string) {
    logForDisplay.push(log);
    while (logForDisplay.length > 200) {
        logForDisplay.shift();
    }
    updateLogMessage();
}

const redactPatterns = [/PBKDF2 salt \(Security Seed\):.*$/];
function redactLog(log: string) {
    let redactedLog = log;
    for (const pattern of redactPatterns) {
        redactedLog = redactedLog.replace(pattern, (match) => {
            return match.split(":")[0] + ": [REDACTED]";
        });
    }
    return redactedLog;
}

// logStore.intercept(e => e.slice(Math.min(e.length - 200, 0)));

const showDebugLog = false;
export const MARK_DONE = "\u{2009}\u{2009}";
export class ModuleLog extends AbstractObsidianModule {
    statusBar?: HTMLElement;


    statusBarLabels!: ReactiveValue<{ icon: string; message: string; level: StatusLevel; detail: string }>;
    statusLog = reactiveSource("");
    /**
     * The most recent thing that went wrong, or "" once it has been read.
     *
     * Held rather than shown. Most failures never stop replication — a file
     * that could not be written, a chunk that could not be decrypted — so
     * without this they would have no representation at all now that the toasts
     * are gone.
     */
    lastProblem = reactiveSource("");

    /**
     * How much of the current burst of work is finished.
     *
     * The status icon does not need this — it turns, and turning already says
     * "not yet". The settings page does: it is the one screen you open *because*
     * you want to know, and a spinner with no end in sight answers the wrong
     * question there.
     *
     * Counted in replication sequence numbers rather than files, because that is
     * the only total known before the work is done. It is not a file count and
     * is not shown as one.
     */
    syncProgress = reactiveSource({ done: 0, total: 0 });

    p2pLogCollector = new P2PLogCollector(this.services.context.events);

    observeForLogs() {
        // Tracks how long the current burst of work has been in flight, so that
        // brief activity is never surfaced. See docs/fork/01-design-principles.md.
        let busySince: number | undefined;
        // When the last burst of work ended, so the icon can show a green tick
        // for a moment afterwards. Undefined until the first one finishes: a
        // vault that has done nothing has nothing to confirm.
        let syncedAt: number | undefined;
        const activeForMs = (busy: boolean): number => {
            if (!busy) {
                if (busySince !== undefined) syncedAt = Date.now();
                busySince = undefined;
                return 0;
            }
            busySince ??= Date.now();
            return Date.now() - busySince;
        };
        const sinceSyncedMs = (): number | undefined => (syncedAt === undefined ? undefined : Date.now() - syncedAt);

        const statusPresentation = computed(() => {
            const stats = this.services.replicator.replicationStatics.value;
            const syncStatus = stats.syncStatus;
            const pendingUpload = Math.max(0, stats.maxPushSeq - stats.lastSyncPushSeq);
            const pendingDownload = Math.max(0, stats.maxPullSeq - stats.lastSyncPullSeq);
            const processing = this.services.fileProcessing.processing.value;
            const queued = this.services.fileProcessing.totalQueued.value;
            const busy = pendingUpload + pendingDownload + processing + queued > 0;
            const settings = this.services.setting.currentSettings();
            // Local work has no denominator — a file being written is not "3 of
            // 40" — so it counts towards the total only while it is outstanding,
            // which keeps the bar from reaching the end before the work does.
            const total = stats.maxPushSeq + stats.maxPullSeq + processing + queued;
            this.syncProgress.value = {
                done: Math.min(stats.lastSyncPushSeq + stats.lastSyncPullSeq, total),
                total,
            };
            return presentStatus({
                connected: syncStatus !== "NOT_CONNECTED" && syncStatus !== "CLOSED",
                anyTriggerEnabled: settings.isConfigured !== true || settings.liveSync === true,
                paused: syncStatus === "PAUSED",
                errored: syncStatus === "ERRORED",
                pendingUpload,
                pendingDownload,
                processing,
                queued,
                conflicts: this.services.conflict.conflictProcessQueueCount.value,
                settingsDecisions: settingsDecisions.value.length,
                restartRequired: this.services.appLifecycle.isReloadingScheduled(),
                restartToApplySettings: restartToApplySettings.value,
                hold: syncHold.value,
                problem: this.lastProblem.value || undefined,
                activeForMs: activeForMs(busy),
                sinceSyncedMs: sinceSyncedMs(),
            });
        });

        const statusBarLabels = reactive(() => {
            const { level, icon, text, detail } = statusPresentation();
            return {
                icon,
                message: text,
                level,
                detail: detail ?? "",
            };
        });
        this.statusBarLabels = statusBarLabels;

        const applyToDisplay = throttle((label: typeof statusBarLabels.value) => {
            // const v = label;
            this.applyStatusBarText();
        }, 20);
        statusBarLabels.onChanged((label) => applyToDisplay(label.value));
    }

    nextFrameQueue: ReturnType<typeof compatGlobal.requestAnimationFrame> | undefined = undefined;
    logLines: { ttl: number; message: string }[] = [];

    applyStatusBarText() {
        if (this.nextFrameQueue) {
            return;
        }
        this.nextFrameQueue = compatGlobal.requestAnimationFrame(() => {
            this.nextFrameQueue = undefined;
            if (!this.statusBar) return;
            const { icon, message, level, detail } = this.statusBarLabels.value;

            // One icon, no text. Silence is the default state: an idle,
            // healthy sync renders nothing at all, so the corner of the screen
            // stays still while the user writes.
            if (isDirty("statusIcon", icon)) {
                this.statusBar.empty();
                if (icon) setIcon(this.statusBar, icon);
            }
            this.statusBar.toggleClass("livesync-status--hidden", icon === "");
            this.statusBar.toggleClass("livesync-status--problem", level === STATUS_PROBLEM);
            this.statusBar.toggleClass("livesync-status--syncing", level === STATUS_SYNCING);
            this.statusBar.toggleClass("livesync-status--synced", level === STATUS_SYNCED);
            this.statusBar.toggleClass("livesync-status--offline", level === STATUS_OFFLINE);
            // The icon alone cannot say which of the states it is, so the words
            // go where a hover and a screen reader both find them.
            const tooltip = [message, detail].filter((e) => e).join("\n");
            this.statusBar.ariaLabel = tooltip || null;

            // The green tick expires on a timer rather than on an event, so
            // something has to come back and clear it.
            if (level === STATUS_SYNCED) {
                scheduleTask("status-synced-expiry", SYNCED_VISIBILITY_MS, () => this.applyStatusBarText());
            }
        });

        scheduleTask("log-hide", 3000, () => {
            this.statusLog.value = "";
        });
    }

    private _allStartOnUnload(): Promise<boolean> {
        compatGlobal.document.querySelectorAll(`.livesync-status`)?.forEach((e) => e.remove());
        return Promise.resolve(true);
    }
    _everyOnloadStart(): Promise<boolean> {
        // No ribbon icon. There were three — replicate, show log, customisation
        // sync — and each was a second door to a command that already existed.
        // The ribbon is the most expensive place in Obsidian to put anything:
        // it is permanently visible, it competes with the user's own plug-ins,
        // and it costs one row of the window forever. Obsidian's own Sync takes
        // none of it and reports itself with a single status-bar icon.
        this.addCommand({
            id: "view-log",
            name: "Show log",
            callback: () => {
                void this.services.API.showWindow(VIEW_TYPE_LOG);
            },
        });
        this.addCommand({
            id: "dump-debug-info",
            name: "Generate full report for opening the issue with debug info",
            callback: async () => {
                const recentLog = [...logForDump];
                const report = await generateReport(this.services.setting.currentSettings(), this.core);
                const info = {
                    ...report,
                    recentLog: recentLog.map(redactLog),
                };
                const yaml = `\`\`\`\`
# ---- Debug Info Dump ----
${stringifyYaml(info)}
\`\`\`\``;
                if (await this.services.UI.promptCopyToClipboard("debug report", yaml)) {
                    new Notice(
                        "Debug info copied to clipboard. You can paste it in the issue. Be careful as it may contain sensitive information, review it before sharing."
                    );
                }
            },
        });
        this.registerView(VIEW_TYPE_LOG, (leaf: WorkspaceLeaf) => new LogPaneView(leaf, this.plugin));
        return Promise.resolve(true);
    }
    private _everyOnloadAfterLoadSettings(): Promise<boolean> {
        recentLogEntries.onChanged((entries) => {
            if (entries.value.length === 0) return;
            const newEntries = [...entries.value];
            recentLogEntries.value = [];
            newEntries.forEach((e) => this.__addLog(e.message, e.level, e.key));
        });
        const w = compatGlobal.document.querySelectorAll(`.livesync-status`);
        w.forEach((e) => e.remove());

        this.observeForLogs();

        const statusBar = this.services.API.addStatusBarItem();
        if (statusBar) {
            statusBar.addClass("syncstatusbar");
            statusBar.addClass("livesync-status--hidden");
            // The icon is now the only thing that reports a failure, so it has
            // to lead somewhere. Pressing it opens the log — the full text of
            // what went wrong, at the moment the reader chose to look — and
            // clears the red, because it has now been read.
            statusBar.addEventListener("click", () => {
                // A settings decision is the one thing the icon reports that
                // the log cannot answer: it is a choice, not an account of
                // something that already happened. So it comes first, and the
                // red stays until it has actually been dealt with.
                const decision = nextSettingsDecision();
                if (decision) {
                    void decision.ask();
                    return;
                }
                this.lastProblem.value = "";
                void this.services.API.showWindow(VIEW_TYPE_LOG);
            });
            this.statusBar = statusBar;
        }
        this._log("Log module loaded", LOG_LEVEL_INFO);
        this._log("Verbose log", LOG_LEVEL_VERBOSE);
        return Promise.resolve(true);
    }

    writeLogToTheFile(now: Date, vaultName: string, newMessage: string) {
        fireAndForget(() =>
            serialized("writeLog", async () => {
                const time = now.toISOString().split("T")[0];
                const logDate = `${PREFIXMD_LOGFILE}${time}.md`;
                const file = await this.core.storageAccess.isExists(normalizePath(logDate));
                if (!file) {
                    await this.core.storageAccess.appendHiddenFile(normalizePath(logDate), "```\n");
                }
                await this.core.storageAccess.appendHiddenFile(
                    normalizePath(logDate),
                    vaultName + ":" + newMessage + "\n"
                );
            })
        );
    }
    __addLog(message: unknown, level: LOG_LEVEL = LOG_LEVEL_INFO, key = ""): void {
        if (level == LOG_LEVEL_DEBUG && !showDebugLog) {
            return;
        }
        let memoOnly = false;
        if (level <= LOG_LEVEL_INFO && this.settings && this.settings.lessInformationInLog) {
            memoOnly = true;
        }
        if (this.settings && !this.settings.showVerboseLog && level == LOG_LEVEL_VERBOSE) {
            memoOnly = true;
        }
        const vaultName = this.services.vault.getVaultName();
        const now = new Date();
        const timestamp = now.toLocaleString();
        let errorInfo = "";
        if (message instanceof Error) {
            if (message instanceof LiveSyncError) {
                if (message.cause && message.cause instanceof Error) {
                    const causedError = message.cause;
                    errorInfo = `${causedError?.name}:${causedError?.message}\n[StackTrace]: ${message.stack}\n[CausedBy]: ${causedError?.stack}`;
                } else {
                    errorInfo = `${message.name}:${message.message}\n[StackTrace]: ${message.stack}`;
                }
            } else {
                const thisStack = new Error().stack;
                errorInfo = `${message.name}:${message.message}\n[StackTrace]: ${message.stack}\n[LogCallStack]: ${thisStack}`;
            }
        }
        const messageContent =
            typeof message == "string"
                ? message
                : message instanceof Error
                  ? `${errorInfo}`
                  : JSON.stringify(message, null, 2);
        const newMessage = timestamp + "->" + messageContent;

        if (this.settings?.writeLogToTheFile) {
            this.writeLogToTheFile(now, vaultName, newMessage);
        }
        addLog(newMessage);
        if (memoOnly) {
            return;
        }
        addDisplayLog(newMessage);
        if (!this.settings?.showOnlyIconsOnEditor) {
            this.statusLog.value = messageContent;
        }
        this.logLines.push({ ttl: now.getTime() + 3000, message: newMessage });

        // Where a toast used to be created. Notice-level lines now reach the
        // reader as one icon: red if this was a fault, nothing otherwise. The
        // text is held so that pressing the icon can show what happened, which
        // is the point at which the reader has chosen to care.
        if (level >= LOG_LEVEL_NOTICE && isProblem(messageContent)) {
            this.lastProblem.value = messageContent;
        }
    }
    override onBindFunction(core: LiveSyncCore, services: typeof core.services): void {
        services.API.addLog.setHandler(globalLogFunction);
        services.appLifecycle.onInitialise.addHandler(this._everyOnloadStart.bind(this));
        services.appLifecycle.onSettingLoaded.addHandler(this._everyOnloadAfterLoadSettings.bind(this));
        services.appLifecycle.onBeforeUnload.addHandler(this._allStartOnUnload.bind(this));
    }
}
