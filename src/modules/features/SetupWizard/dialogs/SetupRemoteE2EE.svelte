<script lang="ts">
    import DialogHeader from "@/modules/services/LiveSyncUI/components/DialogHeader.svelte";
    import Guidance from "@/modules/services/LiveSyncUI/components/Guidance.svelte";
    import Decision from "@/modules/services/LiveSyncUI/components/Decision.svelte";
    import UserDecisions from "@/modules/services/LiveSyncUI/components/UserDecisions.svelte";
    import InfoNote from "@/modules/services/LiveSyncUI/components/InfoNote.svelte";
    import InputRow from "@/modules/services/LiveSyncUI/components/InputRow.svelte";
    import Password from "@/modules/services/LiveSyncUI/components/Password.svelte";
    import { DEFAULT_SETTINGS, type EncryptionSettings } from "@vrtmrz/livesync-commonlib/compat/common/types";
    import { onMount } from "svelte";
    import type { GuestDialogProps } from "@/modules/services/LiveSyncUI/svelteDialog";
    import { copyTo, pickEncryptionSettings } from "@vrtmrz/livesync-commonlib/compat/common/utils";
    import { TYPE_CANCELLED, type SetupRemoteE2EEResultType } from "./setupDialogTypes";
    import { $msg as translateMessage } from "@/common/translation";

    type Props = GuestDialogProps<SetupRemoteE2EEResultType, EncryptionSettings>;
    const { setResult, getInitialData }: Props = $props();
    let default_encryption: EncryptionSettings = {
        encrypt: true,
        passphrase: "",
        E2EEAlgorithm: DEFAULT_SETTINGS.E2EEAlgorithm,
        usePathObfuscation: true,
    } as EncryptionSettings;

    let encryptionSettings = $state<EncryptionSettings>({ ...default_encryption });

    onMount(() => {
        if (getInitialData) {
            const initialData = getInitialData();
            if (initialData) {
                copyTo(initialData, encryptionSettings);
            }
        }
    });
    let e2eeValid = $derived.by(() => {
        if (!encryptionSettings.encrypt) return true;
        return encryptionSettings.passphrase.trim().length >= 1;
    });

    function commit() {
        setResult(pickEncryptionSettings(encryptionSettings));
    }
</script>

<DialogHeader title={translateMessage("End-to-end encryption")} />
<Guidance
    >{translateMessage(
        "Your notes are encrypted on this device before they are sent. The server stores only the encrypted form."
    )}</Guidance
>
<InputRow label={translateMessage("Encrypt this vault")}>
    <input type="checkbox" bind:checked={encryptionSettings.encrypt} />
    <Password
        name="e2ee-passphrase"
        placeholder={translateMessage("Enter your passphrase")}
        bind:value={encryptionSettings.passphrase}
        disabled={!encryptionSettings.encrypt}
        required={encryptionSettings.encrypt}
    />
</InputRow>

<!--
    Two facts, and only two. The algorithm and the property obfuscation used to
    be choices here; both are decisions with one correct answer, and both are
    now applied to every device by the same setup that applies the passphrase.
-->
<InfoNote warning visible={encryptionSettings.encrypt}>
    {translateMessage(
        "Every device must use exactly this passphrase, or they cannot read each other's notes."
    )}
</InfoNote>
<InfoNote warning visible={encryptionSettings.encrypt}>
    {translateMessage(
        "The passphrase is not checked until synchronisation starts. Entering the wrong one on a second device corrupts what is already on the server, and nothing can recover a forgotten passphrase."
    )}
</InfoNote>

<UserDecisions>
    <Decision title={translateMessage("Continue")} important disabled={!e2eeValid} commit={() => commit()} />
    <Decision title={translateMessage("Cancel")} commit={() => setResult(TYPE_CANCELLED)} />
</UserDecisions>
