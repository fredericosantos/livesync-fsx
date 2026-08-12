import { LOG_LEVEL_NOTICE } from "@vrtmrz/livesync-commonlib/compat/common/types";
import type { LogFunction } from "@vrtmrz/livesync-commonlib/compat/services/lib/logUtils";
import { createInstanceLogFunction } from "@vrtmrz/livesync-commonlib/compat/services/lib/logUtils";
import { encodeSettingsToSetupURI } from "@vrtmrz/livesync-commonlib/compat/API/processSetting";
import { EVENT_REQUEST_COPY_SETUP_URI } from "@vrtmrz/livesync-commonlib/compat/events/coreEvents";
import { fireAndForget } from "@vrtmrz/livesync-commonlib/compat/common/utils";
import type { NecessaryServices } from "@vrtmrz/livesync-commonlib/compat/interfaces/ServiceModule";
import type { SetupFeatureHost } from "./types";

export async function askEncryptingPassphrase(host: SetupFeatureHost): Promise<string | false> {
    return await host.services.UI.confirm.askString(
        "Encrypt your settings",
        "The passphrase to encrypt the setup URI",
        "",
        true
    );
}

/**
 * A setup link carries this vault's connection to another device.
 *
 * There were three commands for this, and the reader had to pick between
 * them: "Copy settings as a new setup URI", "(With customization sync)" and
 * "(Full)". The differences were not differences in what the other device ends
 * up with. "Full" only declined to omit settings already at their default —
 * a longer link, an identical result. "With customization sync" included
 * `pluginSyncExtendedSetting`, which records *this* device's per-item choices
 * about which plug-ins to accept; sending it makes the new device inherit
 * decisions made about a machine it is not. So it is always stripped, and there
 * is one command.
 */
export async function copySetupURI(host: SetupFeatureHost, log: LogFunction) {
    const encryptingPassphrase = await askEncryptingPassphrase(host);
    if (encryptingPassphrase === false) return;
    const encryptedURI = await encodeSettingsToSetupURI(
        host.services.setting.currentSettings(),
        encryptingPassphrase,
        ["pluginSyncExtendedSetting"],
        true
    );
    if (await host.services.UI.promptCopyToClipboard("setup link", encryptedURI)) {
        log("Setup URI copied to clipboard", LOG_LEVEL_NOTICE);
    }
}

export function useSetupURIFeature(host: NecessaryServices<"API" | "UI" | "setting" | "appLifecycle", never>) {
    const log = createInstanceLogFunction("SF:SetupURI", host.services.API);
    host.services.appLifecycle.onLoaded.addHandler(() => {
        host.services.API.addCommand({
            id: "livesync-copysetupuri",
            name: "Copy the setup link for another device",
            checkCallback: (checking) => {
                if (!host.services.setting.currentSettings().isConfigured) return false;
                if (!checking) fireAndForget(copySetupURI(host, log));
                return true;
            },
        });

        host.services.context.events.onEvent(EVENT_REQUEST_COPY_SETUP_URI, () =>
            fireAndForget(() => copySetupURI(host, log))
        );
        return Promise.resolve(true);
    });
}
