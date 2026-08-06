/**
 * A first guess at what to call this device.
 *
 * The field used to be blank with a placeholder reading "MacBook Air", which is
 * wrong twice over: it names a machine the reader may not own, and a
 * placeholder is not a value — the setting stayed empty, and Customisation Sync
 * silently does nothing when it is empty.
 *
 * So this produces a real value to prefill, built from what the platform
 * already knows. The user renames it or keeps it; either way the setting is
 * never accidentally blank.
 */

export interface DevicePlatform {
    readonly isPhone: boolean;
    readonly isTablet: boolean;
    readonly isIosApp: boolean;
    readonly isAndroidApp: boolean;
    readonly isMacOS: boolean;
    readonly isWin: boolean;
    readonly isLinux: boolean;
}

/** The kind of machine, in the words someone would use out loud. */
export function describeDevice(platform: DevicePlatform): string {
    if (platform.isPhone) return platform.isIosApp ? "iPhone" : "Phone";
    if (platform.isTablet) return platform.isIosApp ? "iPad" : "Tablet";
    if (platform.isAndroidApp) return "Android";
    if (platform.isIosApp) return "iOS";
    if (platform.isMacOS) return "Mac";
    if (platform.isWin) return "Windows";
    if (platform.isLinux) return "Linux";
    return "Desktop";
}

/**
 * Combines the device kind with the vault name, because one person commonly
 * syncs several vaults from the same machine and "Mac" alone stops being
 * distinguishing the moment they do.
 *
 * `taken` are names already in use; a numeric suffix is added rather than
 * proposing a duplicate, since duplicates are refused on save anyway.
 */
export function suggestDeviceName(
    platform: DevicePlatform,
    vaultName: string,
    taken: readonly string[] = []
): string {
    const device = describeDevice(platform);
    const vault = vaultName.trim();
    // Reserved by the Customisation Sync document key; see deviceNameRules.
    const base = (vault ? `${device} — ${vault}` : device).replace(/[/%]/g, " ").replace(/\s+/g, " ").trim();

    const used = new Set(taken.map((name) => name.trim().toLowerCase()));
    if (!used.has(base.toLowerCase())) return base;
    for (let n = 2; n < 100; n++) {
        const candidate = `${base} ${n}`;
        if (!used.has(candidate.toLowerCase())) return candidate;
    }
    return base;
}
