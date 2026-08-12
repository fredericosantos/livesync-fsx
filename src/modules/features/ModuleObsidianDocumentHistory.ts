import { type TFile } from "@/deps.ts";
import type { FilePathWithPrefix, DocumentID } from "@vrtmrz/livesync-commonlib/compat/common/types";
import { AbstractObsidianModule } from "@/modules/AbstractObsidianModule.ts";
import { DocumentHistoryModal } from "./DocumentHistory/DocumentHistoryModal.ts";

export class ModuleObsidianDocumentHistory extends AbstractObsidianModule {
    _everyOnloadStart(): Promise<boolean> {
        // History is about the file you are looking at. There was a second
        // command, "Pick a file to show history", which listed every document
        // in the database as a row of buttons so that one could be chosen — a
        // file picker built on a confirmation dialogue, in an application whose
        // entire left-hand side is a file picker. Open the file, then ask.
        //
        // It also no longer pretends to work with nothing open: `checkCallback`
        // hides the command instead of accepting the keystroke and doing
        // nothing.
        this.addCommand({
            id: "livesync-history",
            name: "Show earlier versions of this file",
            checkCallback: (checking) => {
                const file = this.services.vault.getActiveFilePath();
                if (!file) return false;
                if (!checking) this.showHistory(file, undefined);
                return true;
            },
        });
        return Promise.resolve(true);
    }

    showHistory(file: TFile | FilePathWithPrefix, id?: DocumentID) {
        new DocumentHistoryModal(this.app, this.core, this.plugin, file, id).open();
    }
    override onBindFunction(core: typeof this.core, services: typeof core.services): void {
        services.appLifecycle.onInitialise.addHandler(this._everyOnloadStart.bind(this));
    }
}
