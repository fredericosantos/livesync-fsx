/**
 * The server's address, and whether it answers.
 *
 * A factory rather than a plain builder: testing the connection needs a
 * replicator, which the Svelte version reached through a context key installed
 * by the dialogue host. Passing it in is the same dependency, said out loud.
 */

import { Platform } from "@/deps.ts";
import type { DialogBuilder } from "@/modules/services/dialogues/DialogManager.ts";
import { decisions, guidance, note, textRow } from "@/modules/services/dialogues/parts.ts";
import {
    DEFAULT_SETTINGS,
    PREFERRED_SETTING_CLOUDANT,
    PREFERRED_SETTING_SELF_HOSTED,
    RemoteTypes,
    type CouchDBConnection,
    type ObsidianLiveSyncSettings,
} from "@vrtmrz/livesync-commonlib/compat/common/types";
import { isCloudantURI } from "@vrtmrz/livesync-commonlib/compat/pouchdb/utils_couchdb";
import { copyTo, pickCouchDBSyncSettings } from "@vrtmrz/livesync-commonlib/compat/common/utils";
import {
    TYPE_CANCELLED,
    type SetupRemoteCouchDBInitialData,
    type SetupRemoteCouchDBResultType,
} from "./setupDialogTypes.ts";
import { explainConnectionFailure, isValidCouchDBServerURL, probeCouchDBConnection } from "./couchDBConnectionProbe.ts";
import { $msg as translateMessage } from "@/common/translation";

/**
 * Just enough of the replicator service to test a connection.
 *
 * `unknown`, because that is what {@link probeCouchDBConnection} takes: the
 * probe only ever hands the replicator back to the library, so naming its type
 * here would tie this dialogue to a class it never calls a method on.
 */
interface ReplicatorSource {
    getNewReplicator(settings: ObsidianLiveSyncSettings): Promise<unknown>;
}

export function setupRemoteCouchDB(
    replicators: ReplicatorSource
): DialogBuilder<SetupRemoteCouchDBResultType, SetupRemoteCouchDBInitialData | undefined> {
    return (el, control, initial) => {
        control.setTitle(translateMessage("Connect to your server"));
        guidance(el, translateMessage("Please enter the CouchDB server information below."));

        const connection: CouchDBConnection = { ...pickCouchDBSyncSettings(DEFAULT_SETTINGS) };
        const mode = initial?.mode ?? "settings";
        if (initial) copyTo(initial.settings, connection);

        const problem = note(el, "error");

        textRow(
            el,
            translateMessage("URL"),
            { value: connection.couchDB_URI, placeholder: "https://example.com" },
            (value) => {
                connection.couchDB_URI = value;
                problem.set("");
            }
        );
        textRow(
            el,
            translateMessage("Username"),
            { value: connection.couchDB_USER, placeholder: translateMessage("Enter your username") },
            (value) => {
                connection.couchDB_USER = value;
                problem.set("");
            }
        );
        textRow(
            el,
            translateMessage("Password"),
            { value: connection.couchDB_PASSWORD, placeholder: translateMessage("Enter your password"), password: true },
            (value) => {
                connection.couchDB_PASSWORD = value;
                problem.set("");
            }
        );
        textRow(
            el,
            translateMessage("Database Name"),
            { value: connection.couchDB_DBNAME, placeholder: translateMessage("Enter your database name") },
            (value) => {
                connection.couchDB_DBNAME = value;
                problem.set("");
            }
        );

        const settingsFromForm = (): ObsidianLiveSyncSettings => ({
            ...DEFAULT_SETTINGS,
            ...(isCloudantURI(connection.couchDB_URI) ? PREFERRED_SETTING_CLOUDANT : PREFERRED_SETTING_SELF_HOSTED),
            remoteType: RemoteTypes.REMOTE_COUCHDB,
            ...connection,
        });

        /**
         * What is wrong with the form, if anything, said only once it is asked
         * for.
         *
         * These used to be live warnings that appeared under the URL box while
         * the reader was still typing it — "Enter a complete HTTP or HTTPS
         * URL." after the first character of `https`, and again after `https:`,
         * and again after `https:/`. Correcting someone mid-word is not help;
         * it is a rebuke for a mistake they have not finished not making.
         */
        const findProblem = (): string => {
            const uri = connection.couchDB_URI.trim();
            if (uri === "") return translateMessage("Enter the address of your server.");
            if (!isValidCouchDBServerURL(uri)) {
                return translateMessage("That does not look like a server address. It should begin with https://");
            }
            if (Platform.isMobile && uri.startsWith("http://")) {
                return translateMessage("Obsidian on this device can only reach servers over https://");
            }
            if (connection.couchDB_USER.trim() === "") return translateMessage("Enter your username.");
            if (connection.couchDB_PASSWORD.trim() === "") return translateMessage("Enter your password.");
            if (connection.couchDB_DBNAME.trim() === "") return translateMessage("Enter the name of the database.");
            return "";
        };

        const checkAndCommit = async (): Promise<void> => {
            const invalid = findProblem();
            if (invalid) {
                problem.set(invalid);
                return;
            }
            problem.set(translateMessage("Checking connection... Please wait."));
            buttons.setPrimaryEnabled(false);
            try {
                const trial = settingsFromForm();
                const replicator = await replicators.getNewReplicator(trial);
                if (!replicator) {
                    problem.set(translateMessage("Failed to create replicator instance."));
                    return;
                }
                const result = await probeCouchDBConnection(replicator, trial, mode === "create-or-connect");
                if (!result.ok) {
                    problem.set(
                        translateMessage("Failed to connect to the server: ${reason}", {
                            reason: explainConnectionFailure(String(result.reason)),
                        })
                    );
                    return;
                }
                control.commit(pickCouchDBSyncSettings(trial));
            } catch (ex) {
                problem.set(
                    translateMessage("Error during connection test: ${reason}", {
                        reason: ex instanceof Error ? ex.message : String(ex),
                    })
                );
            } finally {
                buttons.setPrimaryEnabled(true);
            }
        };

        // Continue is never disabled by the form's state. A greyed-out button
        // gives the reader no way to find out what it wants; pressing it and
        // being told is one step, and it is the step they were going to take
        // anyway. It is disabled only while a check is actually running.
        const buttons = decisions(
            el,
            { label: translateMessage("Cancel"), onClick: () => control.commit(TYPE_CANCELLED) },
            { label: translateMessage("Continue"), primary: true, onClick: () => void checkAndCommit() }
        );
    };
}
