import type { ConfigService } from "@vrtmrz/livesync-commonlib/compat/services/base/ConfigService";
import type { AppLifecycleService } from "@vrtmrz/livesync-commonlib/compat/services/base/AppLifecycleService";
import type { ReplicatorService } from "@vrtmrz/livesync-commonlib/compat/services/base/ReplicatorService";
import { UIService } from "@vrtmrz/livesync-commonlib/compat/services/implements/base/UIService";
import { ObsidianServiceContext } from "@/modules/services/ObsidianServiceContext";
import type { IAPIService, IControlService } from "@vrtmrz/livesync-commonlib/compat/services/base/IService";
import { DialogManager } from "@/modules/services/dialogues/DialogManager.ts";
import { promptCopyToClipboard } from "@/modules/services/dialogues/CopyToClipboardDialog.ts";

export type ObsidianUIServiceDependencies<T extends ObsidianServiceContext = ObsidianServiceContext> = {
    appLifecycle: AppLifecycleService<T>;
    config: ConfigService<T>;
    replicator: ReplicatorService<T>;
    APIService: IAPIService;
    control: IControlService;
};

/**
 * Obsidian's dialogues.
 *
 * There used to be a Svelte dialogue manager here, built from five services and
 * handed to the library so the library could open a component the plug-in
 * supplied. The library no longer renders anything, so what is left is a modal
 * opener that needs an `App`.
 */
export class ObsidianUIService extends UIService<ObsidianServiceContext> {
    private readonly dialogs: DialogManager;

    constructor(context: ObsidianServiceContext, dependents: ObsidianUIServiceDependencies<ObsidianServiceContext>) {
        super(context, { APIService: dependents.APIService });
        this.dialogs = new DialogManager(context.app);
    }

    get dialogManager(): DialogManager {
        return this.dialogs;
    }

    promptCopyToClipboard(title: string, value: string): Promise<boolean> {
        return promptCopyToClipboard(this.context.app, title, value);
    }
}
