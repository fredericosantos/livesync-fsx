import { Logger, LOG_LEVEL_INFO, LOG_LEVEL_NOTICE, LOG_LEVEL_VERBOSE } from "octagonal-wheels/common/logger";
import { extractObject } from "octagonal-wheels/object";
import {
    TweakValuesShouldMatchedTemplate,
    TweakValuesTemplate,
    IncompatibleChanges,
    confName,
    type TweakValues,
    type ObsidianLiveSyncSettings,
    type RemoteDBSettings,
    IncompatibleChangesInSpecificPattern,
    CompatibleButLossyChanges,
} from "@vrtmrz/livesync-commonlib/compat/common/types";
import { escapeMarkdownValue } from "@vrtmrz/livesync-commonlib/compat/common/utils";
import { AbstractModule } from "@/modules/AbstractModule.ts";
import { $msg } from "@/common/translation";
import { HOLD_TWEAKS_INCOMPATIBLE, syncHold } from "@/common/syncHold.ts";
import type { InjectableServiceHub } from "@vrtmrz/livesync-commonlib/compat/services/implements/injectable/InjectableServiceHub";
import type { LiveSyncCore } from "@/main.ts";
import { REMOTE_P2P } from "@vrtmrz/livesync-commonlib/compat/common/models/setting.const";

function valueToString(value: string | number | boolean | object | undefined): string {
    if (typeof value === "boolean") {
        return value ? "true" : "false";
    }
    if (typeof value === "object") {
        return JSON.stringify(value);
    }
    return `${value}`;
}

export class ModuleResolvingMismatchedTweaks extends AbstractModule {
    private _collectMismatchedTweakKeys(current: TweakValues, preferred: Partial<TweakValues>) {
        const items = Object.keys(
            TweakValuesShouldMatchedTemplate
        ) as (keyof typeof TweakValuesShouldMatchedTemplate)[];
        return items.filter((key) => current[key] !== preferred[key]);
    }

    private _selectNewerTweakSide(current: TweakValues, preferred: Partial<TweakValues>): "REMOTE" | "CURRENT" {
        Logger(`Modified: ${current.tweakModified} (current) vs ${preferred.tweakModified} (preferred)`);
        const currentModified = current.tweakModified;
        const preferredModified = preferred.tweakModified;
        // debugger;
        const hasCurrentModified = typeof currentModified === "number" && currentModified > 0;
        const hasPreferredModified = typeof preferredModified === "number" && preferredModified > 0;

        if (!hasCurrentModified && !hasPreferredModified) return "REMOTE";
        if (!hasCurrentModified) return "REMOTE";
        if (!hasPreferredModified) return "CURRENT";
        if (preferredModified >= currentModified) return "REMOTE";
        return "CURRENT";
    }

    private async _shouldAutoAcceptCompatibleLossy(
        current: TweakValues,
        preferred: Partial<TweakValues>,
        mismatchedKeys: (keyof typeof TweakValuesShouldMatchedTemplate)[]
    ): Promise<"REMOTE" | "CURRENT" | undefined> {
        if (mismatchedKeys.length === 0) return undefined;
        const hasOnlyCompatibleLossyMismatches = mismatchedKeys.every(
            (key) => CompatibleButLossyChanges.indexOf(key) !== -1
        );
        if (!hasOnlyCompatibleLossyMismatches) return undefined;

        let autoAcceptCompatibleTweak = this.settings.autoAcceptCompatibleTweak;
        if (this.settings.autoAcceptCompatibleTweak === undefined) {
            // Keep the settings object stable: settings panes and an in-flight replication retry can
            // retain this reference while the default is persisted.
            this.settings.autoAcceptCompatibleTweak = true;
            await this.services.setting.saveSettingData();
            autoAcceptCompatibleTweak = true;
            Logger("Automatic alignment of compatible chunk settings has been enabled.");
        }

        if (autoAcceptCompatibleTweak !== true) return undefined;
        return this._selectNewerTweakSide(current, preferred);
    }

    /**
     * Hook before saving settings, to check if there are changes in tweak values, and if so,
     * update the tweakModified timestamp to current time.
     * This allows other devices to know that the tweak values have been changed and decide whether to accept the new values based on the modification time.
     * @param next
     * @param previous
     * @returns
     */
    async _onBeforeSaveSettingData(next: ObsidianLiveSyncSettings, previous: ObsidianLiveSyncSettings) {
        const tweakKeys = Object.keys(TweakValuesTemplate) as (keyof TweakValues)[];
        const tweakKeysForUpdate = tweakKeys.filter((key) => key !== "tweakModified");
        const hasChangedTweak = tweakKeysForUpdate.some((key) => next[key] !== previous[key]);
        if (!hasChangedTweak) return;
        Logger(
            `Some tweak values have been changed. ${tweakKeysForUpdate.filter((key) => next[key] !== previous[key]).join(", ")}`
        );
        const modified = Date.now();
        Logger(`Modified: ${modified}`);
        return await Promise.resolve({
            tweakModified: modified,
        });
    }

    async _anyAfterConnectCheckFailed(): Promise<boolean | "CHECKAGAIN" | undefined> {
        if (!this.core.replicator.tweakSettingsMismatched && !this.core.replicator.preferredTweakValue) return false;
        const preferred = this.core.replicator.preferredTweakValue;
        if (!preferred) return false;
        const ret = await this.services.tweakValue.askResolvingMismatched(preferred);
        if (ret == "OK") return false;
        if (ret == "CHECKAGAIN") return "CHECKAGAIN";
        if (ret == "IGNORE") return true;
    }

    async _checkAndAskResolvingMismatchedTweaks(preferred: TweakValues): Promise<[TweakValues | boolean, boolean]> {
        const mine = extractObject(TweakValuesTemplate, this.settings) as TweakValues;
        const mismatchedKeys = this._collectMismatchedTweakKeys(mine, preferred);
        const autoAcceptSide = await this._shouldAutoAcceptCompatibleLossy(mine, preferred, mismatchedKeys);
        if (autoAcceptSide === "REMOTE") {
            return [{ ...mine, ...preferred }, false];
        }
        if (autoAcceptSide === "CURRENT") {
            return [true, false];
        }
        const items = Object.entries(TweakValuesShouldMatchedTemplate);
        let rebuildRequired = false;
        // Making tables:
        // let table = `| Value name | This device | Configured | \n` + `|: --- |: --- :|: ---- :| \n`;
        const tableRows = [];
        // const items = [mine,preferred]
        for (const v of items) {
            const key = v[0] as keyof typeof TweakValuesShouldMatchedTemplate;
            const valueMine = escapeMarkdownValue(mine[key]);
            const valuePreferred = escapeMarkdownValue(preferred[key]);
            if (valueMine == valuePreferred) continue;
            if (IncompatibleChanges.indexOf(key) !== -1) {
                rebuildRequired = true;
            }
            for (const pattern of IncompatibleChangesInSpecificPattern) {
                if (pattern.key !== key) continue;
                // if from value supplied, check if current value have been violated : in other words, if the current value is the same as the from value, it should require a rebuild.
                const isFromConditionMet = "from" in pattern ? pattern.from === mine[key] : false;
                // and, if to value supplied, same as above.
                const isToConditionMet = "to" in pattern ? pattern.to === preferred[key] : false;
                // if either of them is true, it should require a rebuild, if the pattern is not a recommendation.
                if (isFromConditionMet || isToConditionMet) {
                    // A recommendation is not a requirement: only
                    // changes the stored data cannot survive force a repair.
                    if (!pattern.isRecommendation) rebuildRequired = true;
                }
            }

            // table += `| ${confName(key)} | ${valueMine} | ${valuePreferred} | \n`;
            tableRows.push(
                $msg("TweakMismatchResolve.Table.Row", {
                    name: confName(key),
                    self: valueToString(valueMine),
                    remote: valueToString(valuePreferred),
                })
            );
        }

        const differences = tableRows.length;

        // The server decides. Every device has to agree on these values to read
        // the same data, and there is exactly one authority for what they are.
        //
        // What stood here was a dialogue of up to seven options — use remote,
        // use mine, either of those with a rebuild, either of those "accepting
        // incompatible" — over a markdown table of internal setting names, with
        // a sixty-second timeout that defaulted to dismissing it. Whichever way
        // that was answered, the device that disagreed with the server stopped
        // syncing until it agreed again.
        if (!rebuildRequired) {
            this._log(
                `Adopted ${differences} setting(s) from the server so this device can read what is stored there.`,
                LOG_LEVEL_INFO
            );
            return [preferred, false];
        }

        // A difference the stored data cannot survive. Nothing is done to the
        // vault behind the reader's back: the status bar says synchronisation
        // is held, and the repair commands are how it is resolved — in the
        // direction they choose, from the device holding the copy they want.
        syncHold.value = HOLD_TWEAKS_INCOMPATIBLE;
        this._log(
            "This device and the server disagree on how content is stored, and the difference cannot be bridged.",
            LOG_LEVEL_INFO
        );
        return [false, false];
    }

    async _askResolvingMismatchedTweaks(): Promise<"OK" | "CHECKAGAIN" | "IGNORE"> {
        if (!this.core.replicator.tweakSettingsMismatched) {
            return "OK";
        }
        const tweaks = this.core.replicator.preferredTweakValue;
        if (!tweaks) {
            return "IGNORE";
        }
        const [conf, rebuildRequired] = await this.services.tweakValue.checkAndAskResolvingMismatched(tweaks);
        if (!conf) return "IGNORE";

        if (conf === true) {
            await this.core.replicator.setPreferredRemoteTweakSettings(this.settings);
            if (rebuildRequired) {
                await this.core.rebuilder.$rebuildRemote();
            }
            Logger($msg("TweakMismatchResolve.Message.remoteUpdated"), LOG_LEVEL_NOTICE);
            return "CHECKAGAIN";
        }
        if (conf) {
            // ReplicationService retains the current settings object while it performs the immediate
            // CHECKAGAIN retry. Update that object in place so the retry observes the accepted values.
            Object.assign(this.settings, extractObject(TweakValuesTemplate, conf));
            await this.services.setting.saveSettingData();
            if (!rebuildRequired) {
                // The failed replication has settled before mismatch resolution runs. Reinitialise the
                // chunk-generation managers now so hash and splitter changes take effect before retrying.
                await this.localDatabase.managers.reinitialise();
            }
            await this.core.replicator.setPreferredRemoteTweakSettings(this.settings);
            if (rebuildRequired) {
                await this.core.rebuilder.$fetchLocal();
            }
            Logger($msg("TweakMismatchResolve.Message.mineUpdated"), LOG_LEVEL_NOTICE);
            return "CHECKAGAIN";
        }
        return "IGNORE";
    }

    async _fetchRemotePreferredTweakValues(trialSetting: RemoteDBSettings): Promise<TweakValues | false> {
        const replicator = await this.services.replicator.getNewReplicator(trialSetting);
        if (!replicator) {
            this._log("This kind of server does not store shared settings.", LOG_LEVEL_VERBOSE);
            return false;
        }
        if (await replicator.tryConnectRemote(trialSetting)) {
            const preferred = await replicator.getRemotePreferredTweakValues(trialSetting);
            if (preferred) {
                return preferred;
            }
            // Connected, and there is nothing stored. That is not a failure:
            // it is what a database that has never been synchronised looks
            // like. Reporting it as an error told a first-time user that
            // something had gone wrong while everything was going right.
            this._log("The server has no shared settings yet.", LOG_LEVEL_VERBOSE);
            return false;
        }
        this._log("Could not reach the server to read its shared settings.", LOG_LEVEL_NOTICE);
        return false;
    }

    async _checkAndAskUseRemoteConfiguration(
        trialSetting: RemoteDBSettings
    ): Promise<{ result: false | TweakValues; requireFetch: boolean }> {
        if (trialSetting.remoteType === REMOTE_P2P) {
            return { result: false, requireFetch: false };
        }
        const preferred = await this.services.tweakValue.fetchRemotePreferred(trialSetting);
        if (preferred) {
            return await this.services.tweakValue.askUseRemoteConfiguration(trialSetting, preferred);
        }
        return { result: false, requireFetch: false };
    }

    async _askUseRemoteConfiguration(
        trialSetting: RemoteDBSettings,
        preferred: TweakValues
    ): Promise<{ result: false | TweakValues; requireFetch: boolean }> {
        const localTweaks = extractObject(TweakValuesTemplate, this.settings) as TweakValues;
        const mismatchedKeys = this._collectMismatchedTweakKeys(localTweaks, preferred);
        const autoAcceptSide = await this._shouldAutoAcceptCompatibleLossy(localTweaks, preferred, mismatchedKeys);
        if (autoAcceptSide === "REMOTE") {
            return { result: { ...trialSetting, ...preferred }, requireFetch: false };
        }
        if (autoAcceptSide === "CURRENT") {
            return { result: false, requireFetch: false };
        }

        const items = Object.entries(TweakValuesShouldMatchedTemplate);
        let rebuildRequired = false;
        // Making tables:
        // let table = `| Value name | This device | On Remote | \n` + `|: --- |: ---- :|: ---- :| \n`;
        let differenceCount = 0;
        const tableRows = [] as string[];
        // const items = [mine,preferred]
        for (const v of items) {
            const key = v[0] as keyof typeof TweakValuesShouldMatchedTemplate;
            const remoteValueForDisplay = escapeMarkdownValue(valueToString(preferred[key]));
            const currentValueForDisplay = escapeMarkdownValue(valueToString((trialSetting as TweakValues)?.[key]));
            if ((trialSetting as TweakValues)?.[key] !== preferred[key]) {
                if (IncompatibleChanges.indexOf(key) !== -1) {
                    rebuildRequired = true;
                }
                for (const pattern of IncompatibleChangesInSpecificPattern) {
                    if (pattern.key !== key) continue;
                    // if from value supplied, check if current value have been violated : in other words, if the current value is the same as the from value, it should require a rebuild.
                    const isFromConditionMet =
                        "from" in pattern ? pattern.from === (trialSetting as TweakValues)?.[key] : false;
                    // and, if to value supplied, same as above.
                    const isToConditionMet = "to" in pattern ? pattern.to === preferred[key] : false;
                    // if either of them is true, it should require a rebuild, if the pattern is not a recommendation.
                    if (isFromConditionMet || isToConditionMet) {
                    // A recommendation is not a requirement: only
                    // changes the stored data cannot survive force a repair.
                    if (!pattern.isRecommendation) rebuildRequired = true;
                    }
                }
            } else {
                continue;
            }
            tableRows.push(
                $msg("TweakMismatchResolve.Table.Row", {
                    name: confName(key),
                    self: currentValueForDisplay,
                    remote: remoteValueForDisplay,
                })
            );
            differenceCount++;
        }

        if (differenceCount === 0) {
            this._log("The settings in the remote database are the same as the local database.", LOG_LEVEL_NOTICE);
            return { result: false, requireFetch: false };
        }
        // Setup reads the server's settings so the new device matches it. That
        // is the only sensible outcome, so it is not offered as one of two
        // buttons over a table of internal setting names.
        this._log(
            `Taking ${differenceCount} setting(s) from the server so this device matches it.`,
            LOG_LEVEL_INFO
        );
        return { result: { ...trialSetting, ...preferred }, requireFetch: rebuildRequired };
    }

    override onBindFunction(core: LiveSyncCore, services: InjectableServiceHub): void {
        services.setting.onBeforeSaveSettingData.addHandler(this._onBeforeSaveSettingData.bind(this));
        services.tweakValue.fetchRemotePreferred.setHandler(this._fetchRemotePreferredTweakValues.bind(this));
        services.tweakValue.checkAndAskResolvingMismatched.setHandler(
            this._checkAndAskResolvingMismatchedTweaks.bind(this)
        );
        services.tweakValue.askResolvingMismatched.setHandler(this._askResolvingMismatchedTweaks.bind(this));
        services.tweakValue.checkAndAskUseRemoteConfiguration.setHandler(
            this._checkAndAskUseRemoteConfiguration.bind(this)
        );
        services.tweakValue.askUseRemoteConfiguration.setHandler(this._askUseRemoteConfiguration.bind(this));
        services.replication.checkConnectionFailure.addHandler(this._anyAfterConnectCheckFailed.bind(this));
    }
}
