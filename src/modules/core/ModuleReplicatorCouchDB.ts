import { fireAndForget } from "octagonal-wheels/promises";
import { type RemoteDBSettings } from "@vrtmrz/livesync-commonlib/compat/common/types";
import { LiveSyncCouchDBReplicator } from "@vrtmrz/livesync-commonlib/compat/replication/couchdb/LiveSyncReplicator";
import type { LiveSyncAbstractReplicator } from "@vrtmrz/livesync-commonlib/compat/replication/LiveSyncAbstractReplicator";
import { AbstractModule } from "@/modules/AbstractModule";
import type { LiveSyncCore } from "@/main";

export class ModuleReplicatorCouchDB extends AbstractModule {
    _anyNewReplicator(settingOverride: Partial<RemoteDBSettings> = {}): Promise<LiveSyncAbstractReplicator | false> {
        const settings = { ...this.settings, ...settingOverride };
        // CouchDB is the only supported remote, and REMOTE_COUCHDB is the empty string. Any non-empty value is
        // therefore a leftover from a backend this fork removed, so refuse to build a replicator for it.
        if (settings.remoteType) {
            return Promise.resolve(false);
        }
        return Promise.resolve(new LiveSyncCouchDBReplicator(this.core));
    }
    _everyAfterResumeProcess(): Promise<boolean> {
        if (this.services.appLifecycle.isSuspended()) return Promise.resolve(true);
        if (!this.services.appLifecycle.isReady()) return Promise.resolve(true);
        // Continuous, or not at all. The `eventualOnStart` branch this replaces
        // ran one finite replication when continuous replication was off, which
        // was the closest the "sync on startup" option came to being a mode:
        // connect once, then go quiet for the rest of the session.
        if (!this.settings.remoteType && this.settings.liveSync) {
            // And note that we do not open the conflict detection dialogue directly during this process.
            // This should be raised explicitly if needed.
            fireAndForget(async () => {
                const canReplicate = await this.services.replication.isReplicationReady(false);
                if (!canReplicate) return;
                void this.core.replicator.openReplication(this.settings, true, false, false);
            });
        }

        return Promise.resolve(true);
    }
    override onBindFunction(core: LiveSyncCore, services: typeof core.services): void {
        services.replicator.getNewReplicator.addHandler(this._anyNewReplicator.bind(this));
        services.appLifecycle.onResumed.addHandler(this._everyAfterResumeProcess.bind(this));
    }
}
