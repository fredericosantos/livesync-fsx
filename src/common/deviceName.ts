/**
 * What this device calls itself.
 *
 * This was a required field on the settings page, with a blank box and a
 * placeholder reading "MacBook Air" — a machine the reader may not own, and a
 * placeholder is not a value, so the setting stayed empty and the feature that
 * needed it silently did nothing.
 *
 * The feature that needed it is gone. What remains is device *identity*: the
 * name that appears against this device in the record of who has caught up with
 * the server. Nobody has ever wanted to type that, and Obsidian's own Sync does
 * not ask — it shows you a list of your devices and names them itself. So this
 * is derived once, at load, and never appears as a question.
 */

const DEVICE_NAME_MAX = 50;

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
 * The machine's own name, if the platform will tell us.
 *
 * On desktop Obsidian is Electron, so Node's `os.hostname()` is reachable
 * through `window.require`. There is no equivalent on mobile: iOS and Android
 * report a class of device, never the name its owner gave it.
 *
 * Impure by nature, and kept apart from {@link suggestDeviceName} so that the
 * naming rules stay testable without a host.
 */
export function readSystemHostName(): string {
    try {
        const nodeRequire = (window as unknown as { require?: (id: string) => unknown }).require;
        if (typeof nodeRequire !== "function") return "";
        const os = nodeRequire("os") as { hostname?: () => string } | undefined;
        return os?.hostname?.() ?? "";
    } catch {
        // Mobile, or a host that does not expose Node. The platform word is
        // then the best available answer, which is what the caller falls back to.
        return "";
    }
}

/**
 * A host name in the form a person would recognise, or empty if it is not one.
 *
 * `os.hostname()` returns the network name, which on macOS is the computer
 * name with punctuation folded out and `.local` appended, but on a strange
 * network can be a DHCP-assigned string that identifies nothing.
 */
export function cleanHostName(raw: string): string {
    // Everything after the first dot is the network's business, not the user's.
    const name = (raw.split(".")[0] ?? "")
        // Kept out because the name is interpolated into document keys.
        .replace(/[/%]/g, " ")
        .replace(/\s+/g, " ")
        .trim();

    if (name === "") return "";
    if (name.length > DEVICE_NAME_MAX) return "";
    // Names that name nothing: the default host name, and the numeric ones
    // handed out by routers.
    if (/^(localhost|unknown|computer|desktop|android|iphone|ipad)$/i.test(name)) return "";
    if (/^[\d-]+$/.test(name)) return "";
    return name;
}

/**
 * What to call this device.
 *
 * The machine's own name if we can read it — it is what the owner already
 * calls it, and it is unique without any help. Otherwise the kind of machine,
 * which is not unique, so the vault name is added to distinguish the common
 * case of several vaults on one computer.
 *
 * `taken` are names already in use; rather than propose a duplicate, the vault
 * name and then a number are appended, since duplicates are refused on save.
 */
export function suggestDeviceName(
    platform: DevicePlatform,
    vaultName: string,
    taken: readonly string[] = [],
    hostName: string = ""
): string {
    const vault = vaultName.replace(/[/%]/g, " ").replace(/\s+/g, " ").trim();
    const host = cleanHostName(hostName);
    const base = host || (vault ? `${describeDevice(platform)} — ${vault}` : describeDevice(platform));

    const used = new Set(taken.map((name) => name.trim().toLowerCase()));
    const isFree = (candidate: string) => !used.has(candidate.toLowerCase());
    if (isFree(base)) return base;

    // A second vault on the same machine: say which vault before resorting to
    // a number, which tells the reader nothing.
    if (vault && !base.endsWith(vault)) {
        const withVault = `${base} — ${vault}`;
        if (isFree(withVault)) return withVault;
    }
    for (let n = 2; n < 100; n++) {
        const candidate = `${base} ${n}`;
        if (isFree(candidate)) return candidate;
    }
    return base;
}
