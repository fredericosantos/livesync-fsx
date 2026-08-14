/**
 * Joining a vault from a link generated on another device.
 */

import type { DialogBuilder } from "@/modules/services/dialogues/DialogManager.ts";
import { decisions, guidance, note, textRow } from "@/modules/services/dialogues/parts.ts";
import { configURIBase } from "@/common/types.ts";
import type { ObsidianLiveSyncSettings } from "@vrtmrz/livesync-commonlib/compat/common/types";
import { decryptString } from "@vrtmrz/livesync-commonlib/compat/encryption/stringEncryption";
import { TYPE_CANCELLED, type UseSetupURIResultType } from "./setupDialogTypes.ts";
import { $msg as translateMessage } from "@/common/translation";

export const useSetupURI: DialogBuilder<UseSetupURIResultType, string | undefined> = (el, control, initialURI) => {
    control.setTitle(translateMessage("Paste the setup link"));
    guidance(
        el,
        translateMessage(
            "Please enter the Setup URI that was generated during server installation or on another device, along with the vault passphrase."
        ),
        translateMessage(
            'Note that you can generate a new Setup URI by running the "Copy settings as a new Setup URI" command in the command palette.'
        )
    );

    let setupURI = initialURI ?? "";
    let passphrase = "";

    const linkNote = note(el, "warning");
    const errorNote = note(el, "error");

    const seemsValid = () => setupURI.startsWith(configURIBase);
    const describeLink = () => {
        if (setupURI.trim() === "" || seemsValid()) {
            linkNote.set("");
            return;
        }
        linkNote.set(
            translateMessage("The Setup-URI does not appear to be valid. Please check that you have copied it correctly.")
        );
    };

    textRow(
        el,
        translateMessage("Setup-URI"),
        { value: setupURI, placeholder: "obsidian://setuplivesync-fsx?settings=...." },
        (value) => {
            setupURI = value;
            errorNote.set("");
            describeLink();
            buttons.setPrimaryEnabled(seemsValid());
        }
    );
    describeLink();

    textRow(
        el,
        translateMessage("Passphrase"),
        { placeholder: translateMessage("Enter your passphrase"), password: true },
        (value) => {
            passphrase = value;
            errorNote.set("");
        }
    );

    const apply = async () => {
        errorNote.set("");
        if (!seemsValid()) return;
        if (!passphrase) {
            errorNote.set(translateMessage("Passphrase is required."));
            return;
        }
        try {
            const encodedConfig = decodeURIComponent(setupURI.substring(configURIBase.length));
            const settings = JSON.parse(await decryptString(encodedConfig, passphrase)) as ObsidianLiveSyncSettings;
            control.commit(settings);
        } catch {
            // A wrong passphrase and a corrupt link fail identically here, and
            // saying which would be a guess.
            errorNote.set(translateMessage("Failed to parse Setup-URI."));
        }
    };

    const buttons = decisions(
        el,
        { label: translateMessage("Cancel"), onClick: () => control.commit(TYPE_CANCELLED) },
        { label: translateMessage("Continue"), primary: true, onClick: () => void apply() }
    );
    buttons.setPrimaryEnabled(seemsValid());
};
