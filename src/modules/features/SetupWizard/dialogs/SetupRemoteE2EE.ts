/**
 * The passphrase, and the two things about it that cannot be undone.
 */

import type { DialogBuilder } from "@/modules/services/dialogues/DialogManager.ts";
import { decisions, guidance, note, textRow, toggleRow } from "@/modules/services/dialogues/parts.ts";
import { DEFAULT_SETTINGS, type EncryptionSettings } from "@vrtmrz/livesync-commonlib/compat/common/types";
import { copyTo, pickEncryptionSettings } from "@vrtmrz/livesync-commonlib/compat/common/utils";
import { TYPE_CANCELLED, type SetupRemoteE2EEResultType } from "./setupDialogTypes.ts";
import { $msg as translateMessage } from "@/common/translation";

export const setupRemoteE2EE: DialogBuilder<SetupRemoteE2EEResultType, EncryptionSettings | undefined> = (
    el,
    control,
    initial
) => {
    control.setTitle(translateMessage("End-to-end encryption"));
    guidance(
        el,
        translateMessage(
            "Your notes are encrypted on this device before they are sent. The server stores only the encrypted form."
        )
    );

    const settings: EncryptionSettings = {
        encrypt: true,
        passphrase: "",
        E2EEAlgorithm: DEFAULT_SETTINGS.E2EEAlgorithm,
        usePathObfuscation: true,
    };
    if (initial) copyTo(initial, settings);

    const valid = () => !settings.encrypt || settings.passphrase.trim().length >= 1;

    toggleRow(el, translateMessage("Encrypt this vault"), { value: settings.encrypt }, (value) => {
        settings.encrypt = value;
        describe();
        buttons.setPrimaryEnabled(valid());
    });

    textRow(
        el,
        translateMessage("Passphrase"),
        { value: settings.passphrase, placeholder: translateMessage("Enter your passphrase"), password: true },
        (value) => {
            settings.passphrase = value;
            buttons.setPrimaryEnabled(valid());
        }
    );

    // Two facts, and only two. The algorithm and the property obfuscation used
    // to be choices here; both are decisions with one correct answer, and both
    // are now applied to every device by the same setup that applies the
    // passphrase.
    const shared = note(el, "warning");
    const unrecoverable = note(el, "warning");
    const describe = () => {
        shared.set(
            settings.encrypt
                ? translateMessage("Every device must use exactly this passphrase, or they cannot read each other's notes.")
                : ""
        );
        unrecoverable.set(
            settings.encrypt
                ? translateMessage(
                      "The passphrase is not checked until synchronisation starts. Entering the wrong one on a second device corrupts what is already on the server, and nothing can recover a forgotten passphrase."
                  )
                : ""
        );
    };
    describe();

    const buttons = decisions(
        el,
        { label: translateMessage("Cancel"), onClick: () => control.commit(TYPE_CANCELLED) },
        {
            label: translateMessage("Continue"),
            primary: true,
            onClick: () => control.commit(pickEncryptionSettings(settings)),
        }
    );
    buttons.setPrimaryEnabled(valid());
};
