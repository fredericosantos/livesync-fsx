import type { NecessaryServices } from "@vrtmrz/livesync-commonlib/compat/interfaces/ServiceModule";
import {
    encodeQR,
    encodeSettingsToQRCodeData,
    OutputFormat,
} from "@vrtmrz/livesync-commonlib/compat/API/processSetting";
import { EVENT_REQUEST_SHOW_SETUP_QR } from "@vrtmrz/livesync-commonlib/compat/events/coreEvents";
import { fireAndForget } from "@vrtmrz/livesync-commonlib/compat/common/utils";
import type { SetupFeatureHost } from "./types";

export async function encodeSetupSettingsAsQR(host: SetupFeatureHost) {
    const settingString = encodeSettingsToQRCodeData(host.services.setting.currentSettings());
    const result = encodeQR(settingString, OutputFormat.SVG);
    if (result === "") {
        return "";
    }

    if (typeof result === "string") {
        const msg = host.services.context.translate("Setup.QRCode", { qr_image: result });
        await host.services.UI.confirm.confirmWithMessage("Scan this on the other device", msg, ["Done"], "Done");
        return result;
    } else {
        // Multi-page QR code
        let currentIndex = 0;
        while (currentIndex < result.total) {
            // The five lines this replaces explained the aggregator, promised
            // nothing was sent to a server, and described what the page would
            // do afterwards — none of which changes what the reader does next,
            // which is scan the code in front of them.
            const msg = `<div class="lsfsx-qr">${result.parts[currentIndex]}</div>

Part ${currentIndex + 1} of ${result.total}. Scan them in order; the page collects them and sends you back to Obsidian.`;

            const buttons = [];
            if (currentIndex > 0) buttons.push("Back");
            if (currentIndex < result.total - 1) {
                buttons.push("Next");
                buttons.push("Cancel");
            } else {
                buttons.push("Done");
            }

            const choice = await host.services.UI.confirm.confirmWithMessage(
                "Scan these in order on the other device",
                msg,
                buttons,
                buttons[buttons.indexOf("Next") !== -1 ? buttons.indexOf("Next") : buttons.indexOf("Done")]
            );

            if (choice === "Next") {
                currentIndex++;
            } else if (choice === "Back") {
                currentIndex--;
            } else {
                break;
            }
        }
        return result.parts[0]; // Return the first one for compatibility
    }
}

export function useSetupQRCodeFeature(host: NecessaryServices<"API" | "UI" | "setting" | "appLifecycle", never>) {
    host.services.appLifecycle.onLoaded.addHandler(() => {
        host.services.API.addCommand({
            id: "livesync-setting-qr",
            name: "Show settings as a QR code",
            checkCallback: (checking) => {
                if (!host.services.setting.currentSettings().isConfigured) return false;
                if (!checking) fireAndForget(encodeSetupSettingsAsQR(host));
                return true;
            },
        });
        host.services.context.events.onEvent(EVENT_REQUEST_SHOW_SETUP_QR, () =>
            fireAndForget(() => encodeSetupSettingsAsQR(host))
        );
        return Promise.resolve(true);
    });
}
