import { computed, reactive, reactiveSource, type ReactiveValue } from "octagonal-wheels/dataobject/reactive";
import {
    LOG_LEVEL_DEBUG,
    LOG_LEVEL_INFO,
    LOG_LEVEL_VERBOSE,
    PREFIXMD_LOGFILE,
    type LOG_LEVEL,
} from "@vrtmrz/livesync-commonlib/compat/common/types";
import { type LogEntry, logMessages } from "@vrtmrz/livesync-commonlib/compat/mock_and_interop/stores";
import { cancelTask, scheduleTask } from "octagonal-wheels/concurrency/task";
import { fireAndForget, isDirty, throttle } from "@vrtmrz/livesync-commonlib/compat/common/utils";
import { AbstractObsidianModule } from "@/modules/AbstractObsidianModule.ts";
import { addIcon, debounce, normalizePath, Notice, setIcon, stringifyYaml, type WorkspaceLeaf } from "@/deps.ts";
import { LOG_LEVEL_NOTICE, setGlobalLogFunction } from "octagonal-wheels/common/logger";
import { LogPaneView, VIEW_TYPE_LOG } from "./Log/LogPaneView.ts";
import { serialized } from "octagonal-wheels/concurrency/lock";
import { $msg } from "@/common/translation";
import { P2PLogCollector } from "@vrtmrz/livesync-commonlib/compat/replication/trystero/P2PLogCollector";
import { STATUS_ACTIVITY, STATUS_ATTENTION, presentStatus, type StatusLevel } from "./StatusPresentation.ts";
import { syncHold } from "@/common/syncHold.ts";
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
    notifies: { [key: string]: { notice: Notice; count: number } } = {};
    p2pLogCollector = new P2PLogCollector(this.services.context.events);

    observeForLogs() {
        // Tracks how long the current burst of work has been in flight, so that
        // brief activity is never surfaced. See docs/fork/01-design-principles.md.
        let busySince: number | undefined;
        const activeForMs = (busy: boolean): number => {
            if (!busy) {
                busySince = undefined;
                return 0;
            }
            busySince ??= Date.now();
            return Date.now() - busySince;
        };

        const statusPresentation = computed(() => {
            const stats = this.services.replicator.replicationStatics.value;
            const syncStatus = stats.syncStatus;
            const pendingUpload = Math.max(0, stats.maxPushSeq - stats.lastSyncPushSeq);
            const pendingDownload = Math.max(0, stats.maxPullSeq - stats.lastSyncPullSeq);
            const processing = this.services.fileProcessing.processing.value;
            const queued = this.services.fileProcessing.totalQueued.value;
            const busy = pendingUpload + pendingDownload + processing + queued > 0;
            return presentStatus({
                connected: syncStatus !== "NOT_CONNECTED" && syncStatus !== "CLOSED",
                paused: syncStatus === "PAUSED",
                errored: syncStatus === "ERRORED",
                pendingUpload,
                pendingDownload,
                processing,
                queued,
                conflicts: this.services.conflict.conflictProcessQueueCount.value,
                restartRequired: this.services.appLifecycle.isReloadingScheduled(),
                hold: syncHold.value,
                activeForMs: activeForMs(busy),
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
            this.statusBar.toggleClass("livesync-status--attention", level === STATUS_ATTENTION);
            this.statusBar.toggleClass("livesync-status--activity", level === STATUS_ACTIVITY);
            // The icon alone cannot say which of the stopped states it is, so
            // the words go where a hover and a screen reader both find them.
            const tooltip = [message, detail].filter((e) => e).join("\n");
            this.statusBar.ariaLabel = tooltip || null;
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
        addIcon(
            "view-log",
            `<g transform="matrix(1.28 0 0 1.28 -131 -411)" fill="currentColor" fill-rule="evenodd">
        <path d="m103 330h76v12h-76z"/>
        <path d="m106 346v44h70v-44zm45 16h-20v-8h20z"/>
       </g>`
        );
        this.addRibbonIcon("view-log", $msg("moduleLog.showLog"), () => {
            void this.services.API.showWindow(VIEW_TYPE_LOG);
        }).addClass("livesync-ribbon-showlog");

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
                if (await this.services.UI.promptCopyToClipboard("Debug info", yaml)) {
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

        if (level >= LOG_LEVEL_NOTICE) {
            if (!key) key = messageContent;
            if (key in this.notifies) {
                // @ts-ignore
                const isShown = this.notifies[key].notice.noticeEl?.isShown();
                if (!isShown) {
                    this.notifies[key].notice = new Notice(messageContent, 0);
                }
                cancelTask(`notify-${key}`);
                if (key == messageContent) {
                    this.notifies[key].count++;
                    this.notifies[key].notice.setMessage(`(${this.notifies[key].count}):${messageContent}`);
                } else {
                    this.notifies[key].notice.setMessage(`${messageContent}`);
                }
            } else {
                const notify = new Notice(messageContent, 0);
                this.notifies[key] = {
                    count: 0,
                    notice: notify,
                };
            }
            const timeout = 5000;
            if (!key.startsWith("keepalive-") || messageContent.indexOf(MARK_DONE) !== -1) {
                scheduleTask(`notify-${key}`, timeout, () => {
                    const notify = this.notifies[key].notice;
                    delete this.notifies[key];
                    try {
                        notify.hide();
                    } catch {
                        // NO OP
                    }
                });
            }
        }
    }
    override onBindFunction(core: LiveSyncCore, services: typeof core.services): void {
        services.API.addLog.setHandler(globalLogFunction);
        services.appLifecycle.onInitialise.addHandler(this._everyOnloadStart.bind(this));
        services.appLifecycle.onSettingLoaded.addHandler(this._everyOnloadAfterLoadSettings.bind(this));
        services.appLifecycle.onBeforeUnload.addHandler(this._allStartOnUnload.bind(this));
    }
}
