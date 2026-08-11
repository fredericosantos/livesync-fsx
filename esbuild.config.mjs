//@ts-check

import esbuild from "esbuild";
import process from "process";
import sveltePlugin from "esbuild-svelte";
import { sveltePreprocess } from "svelte-preprocess";
import fs from "node:fs";
// import terser from "terser";
import { minify } from "terser";
import inlineWorkerPlugin from "esbuild-plugin-inline-worker";
import { terserOption } from "./terser.config.mjs";
import path from "node:path";

const prod = process.argv[2] === "production" || process.env?.BUILD_MODE === "production";
const keepTest = true; //!prod;

const manifestJson = JSON.parse(fs.readFileSync("./manifest.json") + "");
const packageJson = JSON.parse(fs.readFileSync("./package.json") + "");
const updateInfo = JSON.stringify(fs.readFileSync("./updates.md") + "");

const PATHS_TEST_INSTALL = process.env?.PATHS_TEST_INSTALL || "";
const PATH_TEST_INSTALL = PATHS_TEST_INSTALL.split(path.delimiter)
    .map((p) => p.trim())
    .filter((p) => p.length);
if (PATH_TEST_INSTALL) {
    console.log(`Built files will be copied to ${PATH_TEST_INSTALL}`);
} else {
    console.log(
        "Development build: You can install the plug-in to Obsidian for testing by exporting the PATHS_TEST_INSTALL environment variable with the paths to your vault plugins directories separated by your system path delimiter (':' on Unix, ';' on Windows)."
    );
}

/**
 * One Svelte runtime for the whole bundle.
 *
 * `@vrtmrz/livesync-commonlib` is linked from a sibling checkout that has its
 * own `node_modules/svelte`, so ordinary Node resolution gave it a second copy.
 * Svelte tracks the currently-initialising component in a module-level
 * variable, so with two copies `getContext`, `setContext` and `onMount` called
 * from commonlib see no component at all. Every dialogue in the plugin opened
 * as an empty window and threw `lifecycle_outside_component`.
 */
const singleSveltePlugin = {
    name: "single-svelte",
    setup(build) {
        const root = path.resolve(".");
        build.onResolve({ filter: /^svelte($|\/)/ }, async (args) => {
            // Svelte resolving its own subpaths, and our own re-entry, are left
            // alone; only importers outside the runtime get redirected.
            if (args.pluginData?.singleSvelte) return null;
            if (args.resolveDir.includes(`${path.sep}node_modules${path.sep}svelte`)) return null;
            const resolved = await build.resolve(args.path, {
                kind: args.kind,
                resolveDir: root,
                pluginData: { singleSvelte: true },
            });
            if (resolved.errors.length > 0) return null;
            return resolved;
        });
    },
};

const moduleAliasPlugin = {
    name: "module-alias",
    setup(build) {
        build.onResolve({ filter: /.(dev)(.ts|)$/ }, (args) => {
            // console.log(args.path);
            if (prod) {
                let prodTs = args.path.replace(".dev", ".prod");
                const statFile = prodTs.endsWith(".ts") ? prodTs : prodTs + ".ts";
                const realPath = path.join(args.resolveDir, statFile);
                console.log(`Checking ${statFile}`);
                if (fs.existsSync(realPath)) {
                    console.log(`Replaced ${args.path} with ${prodTs}`);
                    return {
                        path: realPath,
                        namespace: "file",
                    };
                }
            }
            return null;
        });
        build.onResolve({ filter: /.(platform)(.ts|)$/ }, (args) => {
            // console.log(args.path);
            if (prod) {
                let prodTs = args.path.replace(".platform", ".obsidian");
                const statFile = prodTs.endsWith(".ts") ? prodTs : prodTs + ".ts";
                const realPath = path.join(args.resolveDir, statFile);
                console.log(`Checking ${statFile}`);
                if (fs.existsSync(realPath)) {
                    console.log(`Replaced ${args.path} with ${prodTs}`);
                    return {
                        path: realPath,
                        namespace: "file",
                    };
                }
            }
            return null;
        });
    },
};

const removePragmaCommentsPlugin = {
    name: "remove-pragma-comments",
    setup(build) {
        const sourceRoot = `${path.resolve("src")}${path.sep}`;
        // Filter target extensions (e.g., JavaScript and TypeScript)
        build.onLoad({ filter: /\.[jt]s?$/ }, async (args) => {
            // Dependencies are already compiled and may contain comment-like text inside strings.
            // Only maintained plug-in source needs its local suppression directives removed.
            if (!args.path.startsWith(sourceRoot)) return;
            const source = await fs.promises.readFile(args.path, "utf8");

            // Regex targeting both single-line and multi-line comments
            // This regex looks for:
            // - /* eslint ... */ (multi-line)
            // const esLintPragmaRegexBlock = /\/\*[\s\S]*?eslint[\s\S]*?\*\/|([^\\:]|^)\/\/.*eslint.*$/gm;
            // - // eslint-disable-next-line
            let cleanedSource = source;
            const tsIgnoreRegex = /\/\*\s*@ts-ignore\s*\*\/|([^\\:]|^)\/\/.*?@ts-ignore.*$/gm;
            const esLintPragmaRegexLine = /([^\\:]|^)\/\/.*?eslint-.*$/gm;
            const exps = [tsIgnoreRegex, esLintPragmaRegexLine];
            for (const exp of exps) {
                cleanedSource = cleanedSource.replace(exp, "$1");
            }

            return {
                contents: cleanedSource,
                loader: args.path.endsWith("ts") ? "ts" : "js",
            };
        });
    },
};

/** @type esbuild.Plugin[] */
const plugins = [
    {
        name: "my-plugin",
        setup(build) {
            let count = 0;
            build.onEnd(async (result) => {
                if (count++ === 0) {
                    console.log("first build:");
                    if (prod) {
                        console.log("MetaFile:");
                        if (result.metafile) {
                            fs.writeFileSync("meta.json", JSON.stringify(result.metafile));
                            let text = await esbuild.analyzeMetafile(result.metafile, {
                                verbose: true,
                            });
                            // console.log(text);
                        }
                    }
                } else {
                    console.log("subsequent build:");
                }
                const filename = `meta-${prod ? "prod" : "dev"}.json`;
                await fs.promises.writeFile(filename, JSON.stringify(result.metafile, null, 2));
                if (prod) {
                    console.log("Performing terser");
                    const src = fs.readFileSync("./main_org.js").toString();
                    // @ts-ignore
                    const ret = await minify(src, terserOption);
                    if (ret && ret.code) {
                        fs.writeFileSync("./main.js", ret.code);
                    }
                    console.log("Finished terser");
                } else {
                    fs.copyFileSync("./main_org.js", "./main.js");
                }
                if (PATH_TEST_INSTALL) {
                    for (const installPath of PATH_TEST_INSTALL) {
                        const realPath = path.resolve(installPath);
                        console.log(`Copying built files to ${realPath}`);
                        if (!fs.existsSync(realPath)) {
                            console.warn(`Test install path ${installPath} does not exist`);
                            continue;
                        }
                        const manifestX = JSON.parse(fs.readFileSync("./manifest.json") + "");
                        manifestX.version = manifestJson.version + "." + Date.now();
                        fs.writeFileSync(path.join(installPath, "manifest.json"), JSON.stringify(manifestX, null, 2));
                        fs.copyFileSync("./main.js", path.join(installPath, "main.js"));
                        fs.copyFileSync("./styles.css", path.join(installPath, "styles.css"));
                    }
                }
            });
        },
    },
];

const externals = [
    "obsidian",
    "electron",
    "crypto",
    "@codemirror/autocomplete",
    "@codemirror/collab",
    "@codemirror/commands",
    "@codemirror/language",
    "@codemirror/lint",
    "@codemirror/search",
    "@codemirror/state",
    "@codemirror/view",
    "@lezer/common",
    "@lezer/highlight",
    "@lezer/lr",
];
const context = await esbuild.context({
    banner: {
        js: "// Leave it all to terser",
    },
    entryPoints: ["src/main.ts"],
    bundle: true,
    define: {
        MANIFEST_VERSION: `"${manifestJson.version}"`,
        PACKAGE_VERSION: `"${packageJson.version}"`,
        UPDATE_INFO: `${updateInfo}`,
        global: "window",
    },
    external: externals,
    // minifyWhitespace: true,
    format: "cjs",
    target: "es2018",
    logLevel: "info",
    platform: "browser",
    metafile: true,
    sourcemap: prod ? false : "inline",
    treeShaking: false,
    outfile: "main_org.js",
    mainFields: ["browser", "module", "main"],
    minifyWhitespace: false,
    minifySyntax: false,
    minifyIdentifiers: false,
    minify: false,
    dropLabels: prod && !keepTest ? ["TEST", "DEV"] : [],
    // keepNames: true,
    plugins: [
        singleSveltePlugin,
        moduleAliasPlugin,
        inlineWorkerPlugin({
            external: externals,
            treeShaking: true,
        }),
        sveltePlugin({
            preprocess: sveltePreprocess(),
            compilerOptions: { css: "injected", preserveComments: false },
        }),
        removePragmaCommentsPlugin,
        ...plugins,
    ],
});

/**
 * A second copy of the Svelte runtime is invisible until a dialogue silently
 * fails to open, so the build refuses to produce one.
 */
function assertSingleSvelteRuntime(bundlePath) {
    const source = fs.readFileSync(bundlePath, "utf-8");
    const copies = [...source.matchAll(/^\/\/ (.*node_modules\/svelte)\/src\//gm)].map((match) => match[1]);
    const distinct = [...new Set(copies)];
    if (distinct.length > 1) {
        throw new Error(
            `Bundled ${distinct.length} copies of the Svelte runtime:\n  ${distinct.join("\n  ")}\n` +
                "Context and lifecycle functions do not work across copies. See singleSveltePlugin."
        );
    }
}

if (prod) {
    await context.rebuild();
    assertSingleSvelteRuntime("main_org.js");
    process.exit(0);
} else {
    await context.watch();
}
