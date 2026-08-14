/**
 * Obsidian, for modules that mention it but must not use it.
 *
 * The unit configuration used to alias `obsidian` to the empty string, so any
 * module that reached it — however indirectly — failed to resolve at all. That
 * was a blunt way to state a good rule: a unit test must not depend on the
 * Obsidian runtime, because there is not one.
 *
 * The rule survives here, stated precisely. Importing is allowed, because a
 * module can legitimately name a type or hold a reference it never calls in the
 * paths under test. *Using* anything throws, so a test that genuinely needs the
 * app fails with a sentence saying so rather than a resolution error thirty
 * frames deep in Vite.
 */

function unavailable(name: string): never {
    throw new Error(
        `${name} is not available in unit tests. Move the logic under test into a module that does not need Obsidian, or write this as a DOM test.`
    );
}

function stubClass(name: string) {
    return class {
        constructor() {
            unavailable(name);
        }
    };
}

export const Modal = stubClass("Modal");
export const Setting = stubClass("Setting");
export const Notice = stubClass("Notice");
export const Plugin = stubClass("Plugin");
export const PluginSettingTab = stubClass("PluginSettingTab");
export const ItemView = stubClass("ItemView");
export const Component = stubClass("Component");
export const Menu = stubClass("Menu");
export const SuggestModal = stubClass("SuggestModal");
export const FuzzySuggestModal = stubClass("FuzzySuggestModal");
export const ButtonComponent = stubClass("ButtonComponent");
export const TextComponent = stubClass("TextComponent");
export const ToggleComponent = stubClass("ToggleComponent");
export const DropdownComponent = stubClass("DropdownComponent");
export const ProgressBarComponent = stubClass("ProgressBarComponent");
export const TFile = stubClass("TFile");
export const TFolder = stubClass("TFolder");
export const TAbstractFile = stubClass("TAbstractFile");
export const WorkspaceLeaf = stubClass("WorkspaceLeaf");
export const App = stubClass("App");
export const MarkdownRenderer = { render: () => unavailable("MarkdownRenderer.render") };

export const Platform = { isMobile: false, isDesktop: true, isIosApp: false, isAndroidApp: false };
export const apiVersion = "0.0.0-unit-test";

export const addIcon = () => unavailable("addIcon");
export const setIcon = () => unavailable("setIcon");
export const requestUrl = () => unavailable("requestUrl");
export const normalizePath = (path: string) => path;
export const debounce = <T extends (...args: never[]) => unknown>(fn: T) => fn;
export const moment = () => unavailable("moment");
export const stringifyYaml = () => unavailable("stringifyYaml");
export const parseYaml = () => unavailable("parseYaml");
export const sanitizeHTMLToDom = () => unavailable("sanitizeHTMLToDom");

export const DIFF_DELETE = -1;
export const DIFF_INSERT = 1;
export const DIFF_EQUAL = 0;
export class diff_match_patch {
    constructor() {
        unavailable("diff_match_patch");
    }
}
