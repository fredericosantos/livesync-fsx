import { Platform } from "@/deps.ts";
import type { LiveSyncCore } from "@/main.ts";
import { AbstractObsidianModule } from "@/modules/AbstractObsidianModule.ts";
import { readSystemHostName, suggestDeviceName } from "@/common/deviceName.ts";
import { LOG_LEVEL_VERBOSE } from "@vrtmrz/livesync-commonlib/compat/common/types";

/**
 * Gives this device a name, once, without asking.
 *
 * The name identifies this device in the record of which devices have caught up
 * with the server — the record "Free up space on the server" consults before it
 * deletes anything. So it has to exist. It does not have to be a question.
 *
 * It used to be a required text field at the top of the settings page, with a
 * blank box, a placeholder naming a laptop the reader might not own, and an
 * inline uniqueness check against every name ever seen in the database. All of
 * that existed because Customisation Sync keyed its per-device documents by
 * this string and silently did nothing when it was empty. Customisation Sync is
 * gone; so is the field. Obsidian's own Sync lists your devices and names them
 * for you, which is the right amount of attention to spend on this.
 */
export class ModuleDeviceName extends AbstractObsidianModule {
    private nameThisDevice(): Promise<boolean> {
        const setting = this.services.setting;
        if (setting.getDeviceAndVaultName()) return Promise.resolve(true);

        const name = suggestDeviceName(Platform, this.app.vault.getName(), [], readSystemHostName());
        setting.setDeviceAndVaultName(name);
        setting.saveDeviceAndVaultName();
        this._log(`This device is now known as "${name}"`, LOG_LEVEL_VERBOSE);
        return Promise.resolve(true);
    }

    override onBindFunction(core: LiveSyncCore, services: typeof core.services): void {
        services.appLifecycle.onInitialise.addHandler(this.nameThisDevice.bind(this));
    }
}
