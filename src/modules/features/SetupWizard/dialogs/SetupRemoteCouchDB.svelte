<script lang="ts">
    import DialogHeader from "@/modules/services/LiveSyncUI/components/DialogHeader.svelte";
    import Guidance from "@/modules/services/LiveSyncUI/components/Guidance.svelte";
    import Decision from "@/modules/services/LiveSyncUI/components/Decision.svelte";
    import UserDecisions from "@/modules/services/LiveSyncUI/components/UserDecisions.svelte";
    import InfoNote from "@/modules/services/LiveSyncUI/components/InfoNote.svelte";
    import InputRow from "@/modules/services/LiveSyncUI/components/InputRow.svelte";
    import Password from "@/modules/services/LiveSyncUI/components/Password.svelte";
    import {
        DEFAULT_SETTINGS,
        PREFERRED_SETTING_CLOUDANT,
        PREFERRED_SETTING_SELF_HOSTED,
        RemoteTypes,
        type CouchDBConnection,
        type ObsidianLiveSyncSettings,
    } from "@vrtmrz/livesync-commonlib/compat/common/types";
    import { isCloudantURI } from "@vrtmrz/livesync-commonlib/compat/pouchdb/utils_couchdb";

    import { onMount } from "svelte";
    import { getDialogContext, type GuestDialogProps } from "@/modules/services/LiveSyncUI/svelteDialog";
    import { copyTo, pickCouchDBSyncSettings } from "@vrtmrz/livesync-commonlib/compat/common/utils";
    import {
        TYPE_CANCELLED,
        type CouchDBSetupMode,
        type SetupRemoteCouchDBInitialData,
        type SetupRemoteCouchDBResultType,
    } from "./setupDialogTypes";
    import { explainConnectionFailure, isValidCouchDBServerURL, probeCouchDBConnection } from "./couchDBConnectionProbe";
    import { $msg as translateMessage } from "@/common/translation";
    import { Platform } from "@/deps.ts";

    const isMobile = Platform.isMobile;

    const default_setting = pickCouchDBSyncSettings(DEFAULT_SETTINGS);

    let syncSetting = $state<CouchDBConnection>({ ...default_setting });
    let setupMode = $state<CouchDBSetupMode>("settings");
    type Props = GuestDialogProps<SetupRemoteCouchDBResultType, SetupRemoteCouchDBInitialData>;
    const { setResult, getInitialData }: Props = $props();
    onMount(() => {
        if (getInitialData) {
            const initialData = getInitialData();
            if (initialData) {
                setupMode = initialData.mode;
                copyTo(initialData.settings, syncSetting);
            }
        }
    });

    let error = $state("");
    const context = getDialogContext();

    function generateSetting() {
        const connSetting: CouchDBConnection = {
            ...syncSetting,
        };
        const trialSettings: CouchDBConnection = {
            ...connSetting,
            // ...encryptionSettings,
        };
        const preferredSetting = isCloudantURI(syncSetting.couchDB_URI)
            ? PREFERRED_SETTING_CLOUDANT
            : PREFERRED_SETTING_SELF_HOSTED;
        const trialRemoteSetting: ObsidianLiveSyncSettings = {
            ...DEFAULT_SETTINGS,
            ...preferredSetting,
            remoteType: RemoteTypes.REMOTE_COUCHDB,
            ...trialSettings,
        };
        return trialRemoteSetting;
    }
    let processing = $state(false);
    async function checkConnection() {
        try {
            processing = true;
            const trialRemoteSetting = generateSetting();
            const replicator = await context.services.replicator.getNewReplicator(trialRemoteSetting);
            if (!replicator) {
                return translateMessage("Failed to create replicator instance.");
            }
            try {
                const result = await probeCouchDBConnection(
                    replicator,
                    trialRemoteSetting,
                    setupMode === "create-or-connect"
                );
                if (result.ok) {
                    return "";
                } else {
                    return translateMessage("Failed to connect to the server: ${reason}", {
                        reason: explainConnectionFailure(`${result.reason}`),
                    });
                }
            } catch (e) {
                return translateMessage("Failed to connect to the server: ${reason}", {
                    reason: explainConnectionFailure(`${e}`),
                });
            }
        } finally {
            processing = false;
        }
    }

    /**
     * What is wrong with the form, if anything, said only once it is asked for.
     *
     * These used to be live warnings that appeared under the URL box while the
     * reader was still typing it — "Enter a complete HTTP or HTTPS URL." after
     * the first character of `https`, and again after `https:`, and again after
     * `https:/`. Correcting someone mid-word is not help; it is a rebuke for a
     * mistake they have not finished not making.
     *
     * The result of pressing Continue is where a verdict belongs, and there is
     * one place it appears — the same note that reports a connection failure.
     */
    function findProblem(): string {
        const uri = syncSetting.couchDB_URI.trim();
        if (uri === "") return translateMessage("Enter the address of your server.");
        if (!isValidCouchDBServerURL(uri)) {
            return translateMessage("That does not look like a server address. It should begin with https://");
        }
        if (isMobile && uri.startsWith("http://")) {
            return translateMessage("Obsidian on this device can only reach servers over https://");
        }
        if (syncSetting.couchDB_USER.trim() === "") return translateMessage("Enter your username.");
        if (syncSetting.couchDB_PASSWORD.trim() === "") return translateMessage("Enter your password.");
        if (syncSetting.couchDB_DBNAME.trim() === "") return translateMessage("Enter the name of the database.");
        return "";
    }

    async function checkAndCommit() {
        error = findProblem();
        if (error) return;
        try {
            error = (await checkConnection()) || "";
            if (!error) {
                const setting = generateSetting();
                setResult(pickCouchDBSyncSettings(setting));
                return;
            }
        } catch (e) {
            error = translateMessage("Error during connection test: ${reason}", { reason: `${e}` });
            return;
        }
    }
    function cancel() {
        setResult(TYPE_CANCELLED);
    }

    // const isURICloudant = $derived.by(() => {
    //     return syncSetting.couchDB_URI && isCloudantURI(syncSetting.couchDB_URI);
    // });
    // const isURISelfHosted = $derived.by(() => {
    //     return syncSetting.couchDB_URI && !isCloudantURI(syncSetting.couchDB_URI);
    // });
    // Continue is never disabled. A greyed-out button gives the reader no way
    // to find out what it wants; pressing it and being told is one step, and it
    // is the step they were going to take anyway.
</script>

<DialogHeader title={translateMessage("Connect to your server")} />
<Guidance>{translateMessage("Please enter the CouchDB server information below.")}</Guidance>
<InputRow label={translateMessage("URL")}>
    <input
        type="text"
        name="couchdb-url"
        placeholder="https://example.com"
        autocorrect="off"
        autocapitalize="off"
        spellcheck="false"
        bind:value={syncSetting.couchDB_URI}
        required
        pattern="^https?://.+"
    />
</InputRow>
<InputRow label={translateMessage("Username")}>
    <input
        type="text"
        name="couchdb-username"
        placeholder={translateMessage("Enter your username")}
        autocorrect="off"
        autocapitalize="off"
        spellcheck="false"
        required
        bind:value={syncSetting.couchDB_USER}
    />
</InputRow>
<InputRow label={translateMessage("Password")}>
    <Password
        name="couchdb-password"
        placeholder={translateMessage("Enter your password")}
        bind:value={syncSetting.couchDB_PASSWORD}
        required
    />
</InputRow>

<InputRow label={translateMessage("Database Name")}>
    <input
        type="text"
        name="couchdb-database"
        placeholder={translateMessage("Enter your database name")}
        autocorrect="off"
        autocapitalize="off"
        spellcheck="false"
        required
        bind:value={syncSetting.couchDB_DBNAME}
    />
</InputRow>
<InfoNote error visible={error !== ""}>
    {error}
</InfoNote>

{#if processing}
    {translateMessage("Checking connection... Please wait.")}
{:else}
    <UserDecisions>
        <Decision title={translateMessage("Continue")} important commit={() => checkAndCommit()} />
        <Decision title={translateMessage("Cancel")} commit={() => cancel()} />
    </UserDecisions>
{/if}
