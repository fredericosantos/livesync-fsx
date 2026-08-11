import { sizeToHumanReadable } from "octagonal-wheels/number";
import {
    LOG_LEVEL_NOTICE,
    REMOTE_COUCHDB,
    type DocumentID,
    type EntryLeaf,
    type MetaEntry,
} from "@vrtmrz/livesync-commonlib/compat/common/types";
import { getNoFromRev } from "@vrtmrz/livesync-commonlib/compat/pouchdb/LiveSyncLocalDB";
import { LiveSyncCommands } from "@/features/LiveSyncCommands";
import { EVENT_REQUEST_PERFORM_GC_V3, eventHub } from "@/common/events";
import type { LiveSyncCouchDBReplicator } from "@vrtmrz/livesync-commonlib/compat/replication/couchdb/LiveSyncReplicator";
import { delay } from "@vrtmrz/livesync-commonlib/compat/common/utils";
import { ensureLocalDatabaseMaintenancePrerequisites } from "./maintenancePrerequisites";
// import { _requestToCouchDB } from "@/common/utils";
const DB_KEY_CHUNK_SET = "chunk-set";
const DB_KEY_DOC_USAGE_MAP = "doc-usage-map";
type ChunkID = DocumentID;
type NoteDocumentID = DocumentID;
type Rev = string;

type ChunkUsageMap = Map<NoteDocumentID, Map<Rev, Set<ChunkID>>>;
export class LocalDatabaseMaintenance extends LiveSyncCommands {
    onunload(): void {
        // NO OP.
    }
    onload(): void | Promise<void> {
        // NO OP.
        this.plugin.addCommand({
            id: "gc-v3",
            name: "Free up space on the server",
            icon: "trash-2",
            checkCallback: (checking) => {
                const isApplicableRemote = this.settings.remoteType === REMOTE_COUCHDB;
                if (!this._isDatabaseReady() || !isApplicableRemote) {
                    return false;
                }
                if (!checking) {
                    void this.gcv3();
                }
                return true;
            },
        });
        eventHub.onEvent(EVENT_REQUEST_PERFORM_GC_V3, () => this.gcv3());
    }
    async allChunks(includeDeleted: boolean = false) {
        const p = this._progress("", LOG_LEVEL_NOTICE);
        p.log("Retrieving chunks informations..");
        try {
            const ret = await this.localDatabase.allChunks(includeDeleted);
            return ret;
        } finally {
            p.done();
        }
    }
    get database() {
        return this.localDatabase.localDatabase;
    }
    clearHash() {
        this.localDatabase.clearCaches();
    }

    async confirm(title: string, message: string, affirmative = "Yes", negative = "No") {
        return (
            (await this.core.confirm.askSelectStringDialogue(message, [affirmative, negative], {
                title,
                defaultAction: affirmative,
            })) === affirmative
        );
    }
    async ensureAvailable(operationName: string) {
        return await ensureLocalDatabaseMaintenancePrerequisites({
            operationName,
            settings: this.settings,
            askSelectStringDialogue: this.core.confirm.askSelectStringDialogue.bind(this.core.confirm),
            applyPartial: async (settings, saveImmediately) => {
                await this.core.services.setting.applyPartial(settings, saveImmediately);
                Object.assign(this.core.settings, settings);
            },
        });
    }
    /**
     * Resurrect deleted chunks that are still used in the database.
     */
    async resurrectChunks() {
        if (!(await this.ensureAvailable("Resurrect Chunks"))) return;
        const { used, existing } = await this.allChunks(true);
        const excessiveDeletions = [...existing]
            .filter(([key, e]) => e._deleted)
            .filter(([key, e]) => used.has(e._id))
            .map(([key, e]) => e);
        const completelyLostChunks = [] as string[];
        // Data lost chunks : chunks that are deleted and data is purged.
        const dataLostChunks = [...existing]
            .filter(([key, e]) => e._deleted && e.data === "")
            .map(([key, e]) => e)
            .filter((e) => used.has(e._id));
        for (const e of dataLostChunks) {
            // Retrieve the data from the previous revision.
            const doc = await this.database.get(e._id, { rev: e._rev, revs: true, revs_info: true, conflicts: true });
            const history = doc._revs_info || [];
            // Chunks are immutable. So, we can resurrect the chunk by copying the data from any of previous revisions.
            let resurrected = null as null | string;
            const availableRevs = history
                .filter((e) => e.status == "available")
                .map((e) => e.rev)
                .sort((a, b) => getNoFromRev(a) - getNoFromRev(b));
            for (const rev of availableRevs) {
                const revDoc = await this.database.get(e._id, { rev: rev });
                if (revDoc.type == "leaf" && revDoc.data !== "") {
                    // Found the data.
                    resurrected = revDoc.data;
                    break;
                }
            }
            // If the data is not found, we cannot resurrect the chunk, add it to the excessiveDeletions.
            if (resurrected !== null) {
                excessiveDeletions.push({ ...e, data: resurrected, _deleted: false });
            } else {
                completelyLostChunks.push(e._id);
            }
        }
        // Chunks to be resurrected.
        const resurrectChunks = excessiveDeletions.filter((e) => e.data !== "").map((e) => ({ ...e, _deleted: false }));

        if (resurrectChunks.length == 0) {
            this._notice("No chunks are found to be resurrected.");
            return;
        }
        const message = `We have following chunks that are deleted but still used in the database.

- Completely lost chunks: ${completelyLostChunks.length}
- Resurrectable chunks: ${resurrectChunks.length}

Do you want to resurrect these chunks?`;
        if (await this.confirm("Resurrect Chunks", message, "Resurrect", "Cancel")) {
            const result = await this.database.bulkDocs(resurrectChunks);
            this.clearHash();
            const resurrectedChunks = result.filter((e) => "ok" in e).map((e) => e.id);
            this._notice(`Resurrected chunks: ${resurrectedChunks.length} / ${resurrectChunks.length}`);
        } else {
            this._notice("Resurrect operation is cancelled.");
        }
    }
    /**
     * Commit deletion of files that are marked as deleted.
     * This method makes the deletion permanent, and the files will not be recovered.
     * After this, chunks that are used in the deleted files become ready for compaction.
     */
    async commitFileDeletion() {
        if (!(await this.ensureAvailable("Delete Files"))) return;
        const p = this._progress("", LOG_LEVEL_NOTICE);
        p.log("Searching for deleted files..");
        const docs = await this.database.allDocs<MetaEntry>({ include_docs: true });
        const deletedDocs = docs.rows.filter(
            (e) => (e.doc?.type == "newnote" || e.doc?.type == "plain") && e.doc?.deleted
        );
        if (deletedDocs.length == 0) {
            p.done("No deleted files found.");
            return;
        }
        p.log(`Found ${deletedDocs.length} deleted files.`);

        const message = `We have following files that are marked as deleted.

- Deleted files: ${deletedDocs.length}

Are you sure to delete these files permanently?

Note: **Make sure to synchronise all devices before deletion.**

> [!Note]
> This operation affects the database permanently. Deleted files will not be recovered after this operation.
> And, the chunks that are used in the deleted files will be ready for compaction.`;

        const deletingDocs = deletedDocs.map((e) => ({ ...e.doc, _deleted: true }) as MetaEntry);

        if (await this.confirm("Delete Files", message, "Delete", "Cancel")) {
            const result = await this.database.bulkDocs(deletingDocs);
            this.clearHash();
            p.done(`Deleted ${result.filter((e) => "ok" in e).length} / ${deletedDocs.length} files.`);
        } else {
            p.done("Deletion operation is cancelled.");
        }
    }
    /**
     * Commit deletion of chunks that are not used in the database.
     * This method makes the deletion permanent, and the chunks will not be recovered if the database run compaction.
     * After this, the database can shrink the database size by compaction.
     * It is recommended to compact the database after this operation (History should be kept once before compaction).
     */
    async commitChunkDeletion() {
        if (!(await this.ensureAvailable("Delete Chunks"))) return;
        const { existing } = await this.allChunks(true);
        const deletedChunks = [...existing].filter(([key, e]) => e._deleted && e.data !== "").map(([key, e]) => e);
        const deletedNotVacantChunks = deletedChunks.map((e) => ({ ...e, data: "", _deleted: true }));
        const size = deletedChunks.reduce((acc, e) => acc + e.data.length, 0);
        const humanSize = sizeToHumanReadable(size);
        const message = `We have following chunks that are marked as deleted.

- Deleted chunks: ${deletedNotVacantChunks.length} (${humanSize})

Are you sure to delete these chunks permanently?

Note: **Make sure to synchronise all devices before deletion.**

> [!Note]
> This operation finally reduces the capacity of the remote.`;

        if (deletedNotVacantChunks.length == 0) {
            this._notice("No deleted chunks found.");
            return;
        }
        if (await this.confirm("Delete Chunks", message, "Delete", "Cancel")) {
            const result = await this.database.bulkDocs(deletedNotVacantChunks);
            this.clearHash();
            this._notice(
                `Deleted chunks: ${result.filter((e) => "ok" in e).length} / ${deletedNotVacantChunks.length}`
            );
        } else {
            this._notice("Deletion operation is cancelled.");
        }
    }
    /**
     * Compact the database.
     * This method removes all deleted chunks that are not used in the database.
     * Make sure all devices are synchronized before running this method.
     */
    async markUnusedChunks() {
        if (!(await this.ensureAvailable("Mark unused chunks"))) return;
        const { used, existing } = await this.allChunks();
        const existChunks = [...existing];
        const unusedChunks = existChunks.filter(([key, e]) => !used.has(e._id)).map(([key, e]) => e);
        const deleteChunks = unusedChunks.map((e) => ({
            ...e,
            _deleted: true,
        }));
        const size = deleteChunks.reduce((acc, e) => acc + e.data.length, 0);
        const humanSize = sizeToHumanReadable(size);
        if (deleteChunks.length == 0) {
            this._notice("No unused chunks found.");
            return;
        }
        const message = `We have following chunks that are not used from any files.

- Chunks: ${deleteChunks.length} (${humanSize})

Are you sure to mark these chunks to be deleted?

Note: **Make sure to synchronise all devices before deletion.**

> [!Note]
> This operation will not reduces the capacity of the remote until permanent deletion.`;

        if (await this.confirm("Mark unused chunks", message, "Mark", "Cancel")) {
            const result = await this.database.bulkDocs(deleteChunks);
            this.clearHash();
            this._notice(`Marked chunks: ${result.filter((e) => "ok" in e).length} / ${deleteChunks.length}`);
        }
    }

    async removeUnusedChunks() {
        if (!(await this.ensureAvailable("Delete unused chunks"))) return;
        const { used, existing } = await this.allChunks();
        const existChunks = [...existing];
        const unusedChunks = existChunks.filter(([key, e]) => !used.has(e._id)).map(([key, e]) => e);
        const deleteChunks = unusedChunks.map((e) => ({
            ...e,
            data: "",
            _deleted: true,
        }));
        const size = unusedChunks.reduce((acc, e) => acc + e.data.length, 0);
        const humanSize = sizeToHumanReadable(size);
        if (deleteChunks.length == 0) {
            this._notice("No unused chunks found.");
            return;
        }
        const message = `We have following chunks that are not used from any files.

- Chunks: ${deleteChunks.length} (${humanSize})

Are you sure to delete these chunks?

Note: **Make sure to synchronise all devices before deletion.**

> [!Note]
> Chunks referenced from deleted files are not deleted. Please run "Commit File Deletion" before this operation.`;

        if (await this.confirm("Mark unused chunks", message, "Mark", "Cancel")) {
            const result = await this.database.bulkDocs(deleteChunks);
            this._notice(`Deleted chunks: ${result.filter((e) => "ok" in e).length} / ${deleteChunks.length}`);
            this.clearHash();
        }
    }

    async scanUnusedChunks() {
        const kvDB = this.core.kvDB;
        const chunkSet = (await kvDB.get<Set<DocumentID>>(DB_KEY_CHUNK_SET)) || new Set();
        const chunkUsageMap = (await kvDB.get<ChunkUsageMap>(DB_KEY_DOC_USAGE_MAP)) || new Map();
        const KEEP_MAX_REVS = 10;
        const unusedSet = new Set<DocumentID>([...chunkSet]);
        for (const [, revIdMap] of chunkUsageMap) {
            const sortedRevId = [...revIdMap.entries()].sort((a, b) => getNoFromRev(b[0]) - getNoFromRev(a[0]));
            if (sortedRevId.length > KEEP_MAX_REVS) {
                // If we have more revisions than we want to keep, we need to delete the extras
            }
            const keepRevID = sortedRevId.slice(0, KEEP_MAX_REVS);
            keepRevID.forEach((e) => e[1].forEach((ee: DocumentID) => unusedSet.delete(ee)));
        }
        return {
            chunkSet,
            chunkUsageMap,
            unusedSet,
        };
    }
    /**
     * Track changes in the database and update the chunk usage map for garbage collection.
     * Note that this only able to perform without Fetch chunks on demand.
     */
    async compactDatabase() {
        const replicator = this.core.replicator as LiveSyncCouchDBReplicator;
        const remote = await replicator.connectRemoteCouchDBWithSetting(this.settings, false, false, true);
        if (!remote) {
            this._notice("Failed to connect to remote for compaction.", "gc-compact");
            return;
        }
        if (typeof remote == "string") {
            this._notice(`Failed to connect to remote for compaction. ${remote}`, "gc-compact");
            return;
        }
        const compactResult = await remote.db.compact({
            interval: 1000,
        });
        // Probably no need to wait, but just in case.
        let timeout = 2 * 60 * 1000; // 2 minutes
        for (;;) {
            const status = await remote.db.info();
            if ("compact_running" in status && status?.compact_running) {
                this._notice("Compaction in progress on remote database...", "gc-compact");
                await delay(2000);
                timeout -= 2000;
                if (timeout <= 0) {
                    this._notice("Compaction on remote database timed out.", "gc-compact");
                    return;
                }
            } else {
                break;
            }
        }
        if (compactResult && "ok" in compactResult) {
            this._notice("Compaction on remote database completed successfully.", "gc-compact");
        } else {
            this._notice("Compaction on remote database failed.", "gc-compact");
        }
    }

    // /**
    //  * Compact the database by temporarily setting the revision limit to 1.
    //  * @returns
    //  */
    // async compactDatabaseWithRevLimit() {
    //     // Temporarily set revs_limit to 1, perform compaction, and restore the original revs_limit.
    //     // Very dangerous operation, so now suppressed.
    //     return Promise.resolve(false);
    //     const replicator = this.core.replicator as LiveSyncCouchDBReplicator;
    //     const remote = await replicator.connectRemoteCouchDBWithSetting(this.settings, false, false, true);
    //     if (!remote) {
    //         this._notice("Failed to connect to remote for compaction.");
    //         return;
    //     }
    //     if (typeof remote == "string") {
    //         this._notice(`Failed to connect to remote for compaction. ${remote}`);
    //         return;
    //     }
    //     const customHeaders = parseHeaderValues(this.settings.couchDB_CustomHeaders);
    //     const credential = generateCredentialObject(this.settings);
    //     const request = async (path: string, method: string = "GET", body: any = undefined) => {
    //         const req = await _requestToCouchDB(
    //             this.settings.couchDB_URI.replace(/\/+$/, "") +
    //             (this.settings.couchDB_DBNAME ? `/${this.settings.couchDB_DBNAME}` : ""),
    //             credential,
    //             window.origin,
    //             path,
    //             body,
    //             method,
    //             customHeaders
    //         );
    //         return req;
    //     };
    //     let revsLimit = "";
    //     const req = await request(`_revs_limit`, "GET");
    //     if (req.status == 200) {
    //         revsLimit = req.text.trim();
    //         this._info(`Remote database _revs_limit: ${revsLimit}`);
    //     } else {
    //         this._notice(`Failed to get remote database _revs_limit. Status: ${req.status}`);
    //         return;
    //     }
    //     const req2 = await request(`_revs_limit`, "PUT", 1);
    //     if (req2.status == 200) {
    //         this._info(`Set remote database _revs_limit to 1 for compaction.`);
    //     }
    //     try {
    //         await this.compactDatabase();
    //     } finally {
    //         // Restore revs_limit
    //         if (revsLimit) {
    //             const req3 = await request(`_revs_limit`, "PUT", parseInt(revsLimit));
    //             if (req3.status == 200) {
    //                 this._info(`Restored remote database _revs_limit to ${revsLimit}.`);
    //             } else {
    //                 this._notice(
    //                     `Failed to restore remote database _revs_limit. Status: ${req3.status} / ${req3.text}`
    //                 );
    //             }
    //         }
    //     }
    // }
    async gcv3() {
        if (!(await this.ensureAvailable("Garbage Collection"))) return;
        const replicator = this.core.replicator as LiveSyncCouchDBReplicator;
        // Start one-shot replication to ensure all changes are synced before GC.
        const r0 = await replicator.openOneShotReplication(this.settings, false, false, "sync");
        if (!r0) {
            this._notice(
                "Failed to start one-shot replication before Garbage Collection. Garbage Collection Cancelled."
            );
            return;
        }

        // Delete the chunk, but first verify the following:
        // Fetch the list of accepted nodes from the replicator.
        const OPTION_CANCEL = "Cancel Garbage Collection";
        const info = await this.core.replicator.getConnectedDeviceList();
        if (!info) {
            this._notice("No connected device information found. Cancelling Garbage Collection.");
            return;
        }
        const { accepted_nodes, node_info } = info;
        //1. Compare accepted_nodes and node_info, and confirm whether it is acceptable to delete nodes not present in node_info.
        const infoMissingNodes = [] as string[];
        for (const node of accepted_nodes) {
            if (!(node in node_info)) {
                infoMissingNodes.push(node);
            }
        }
        // Everything below used to be shown to the reader: a dialogue about
        // "accepted nodes missing node information", then a second one with a
        // callout listing each device's node id, Obsidian version, plug-in
        // version and replication progress. Both were asking one question —
        // is every device up to date with the server? — in the vocabulary of
        // the implementation. The plug-in can answer it, so it answers it.
        const devicesBehind = infoMissingNodes.length > 0;

        //2. Check whether the progress values in NodeData are roughly the same (only the numerical part is needed).
        const progressValues = Object.values(node_info).map((entry) => {
            const progress = typeof entry.progress === "string" ? entry.progress.split("-")[0] : "";
            return /^\d+$/u.test(progress) ? Number(progress) : Number.NaN;
        });
        if (progressValues.length === 0 || progressValues.some((progress) => !Number.isSafeInteger(progress))) {
            this._notice("No connected device information found. Cancelling Garbage Collection.");
            return;
        }
        const progressDifference = Math.max(...progressValues) - Math.min(...progressValues);
        const notAllCaughtUp = devicesBehind || progressDifference !== 0;

        const OPTION_PROCEED = "Free up space";
        const message = notAllCaughtUp
            ? "Some of your devices have not finished syncing with the server. Freeing up space now can lose whatever they have not sent yet. Open Obsidian on each of them, let it finish, then try again."
            : `Content no longer referenced by any file will be removed from the server. All ${progressValues.length} devices are up to date, so nothing in use will be lost.`;
        const result = await this.core.confirm.askSelectStringDialogue(message, [OPTION_PROCEED, OPTION_CANCEL], {
            title: "Free up space on the server",
            defaultAction: notAllCaughtUp ? OPTION_CANCEL : OPTION_PROCEED,
        });
        if (result !== OPTION_PROCEED) {
            this._notice("Freeing up space cancelled.");
            return;
        }
        this._notice("Proceeding with Garbage Collection.");
        //-  3. Once OK is confirmed in the dialogue, execute the chunk deletion. This is performed on the local database and immediately reflected on the remote. After reflecting on the remote, perform compaction.
        const gcStartTime = Date.now();
        // Perform Garbage Collection (new implementation).
        const localDatabase = this.localDatabase.localDatabase;
        // Use the revision-aware reachability scan. Reading only winning revisions
        // would make chunks used exclusively by live conflict branches look unused.
        const { used: usedChunks, existing: allChunks } = await this.localDatabase.allChunks();
        this._notice(
            `Garbage Collection: Scanning completed. Total chunks: ${allChunks.size}, Used chunks: ${usedChunks.size}`,
            "gc-scanning"
        );

        const unusedChunks = [...allChunks.entries()].filter(([chunkId]) => !usedChunks.has(chunkId));
        this._notice(`Garbage Collection: Found ${unusedChunks.length} unused chunks to delete.`, "gc-scanning");
        const deleteChunkDocs = unusedChunks.map(
            ([chunkId, chunk]) =>
                ({
                    _id: chunkId as DocumentID,
                    _deleted: true,
                    _rev: chunk._rev,
                }) as EntryLeaf
        );
        const response = await localDatabase.bulkDocs(deleteChunkDocs);
        const deletedCount = response.filter((e) => "ok" in e).length;
        const gcEndTime = Date.now();
        this._notice(
            `Garbage Collection completed. Deleted chunks: ${deletedCount} / ${unusedChunks.length}. Time taken: ${(gcEndTime - gcStartTime) / 1000} seconds.`
        );
        // Send changes to remote
        const r = await replicator.openOneShotReplication(this.settings, false, false, "pushOnly");
        // Wait for replication to complete
        if (!r) {
            this._notice("Failed to start replication after Garbage Collection.");
            return;
        }
        // Perform compaction
        await this.compactDatabase();
        this.clearHash();
    }
}
