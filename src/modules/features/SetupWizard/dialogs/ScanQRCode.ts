/**
 * How to get a setup link across using the phone's own camera.
 *
 * Obsidian has no camera API and this plug-in ships no scanner, so the steps
 * hand the job to the camera app the reader already has — which is why this is
 * four sentences rather than a dependency.
 */

import type { DialogBuilder } from "@/modules/services/dialogues/DialogManager.ts";
import { decisions, guidance, steps } from "@/modules/services/dialogues/parts.ts";
import { TYPE_CLOSE, type ScanQRCodeResultType } from "./setupDialogTypes.ts";
import { $msg as translateMessage } from "@/common/translation";

export const scanQRCode: DialogBuilder<ScanQRCodeResultType> = (el, control) => {
    control.setTitle(translateMessage("Scan the QR code"));
    guidance(el, translateMessage("Please follow the steps below to import settings from your existing device."));
    steps(
        el,
        translateMessage("On this device, please keep this Vault open."),
        translateMessage("On the source device, open Obsidian."),
        translateMessage("On the source device, from the command palette, run the 'Show settings as a QR code' command."),
        translateMessage("On this device, switch to the camera app or use a QR code scanner to scan the displayed QR code.")
    );
    decisions(el, { label: translateMessage("Close"), primary: true, onClick: () => control.commit(TYPE_CLOSE) });
};
