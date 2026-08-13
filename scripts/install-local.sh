#!/usr/bin/env bash
#
# Install this build into a vault.
#
# This exists because installing by hand went wrong: `main.js`, `manifest.json`
# and `styles.css` were copied into `.obsidian/plugins/obsidian-livesync/` — the
# folder belonging to the *upstream* plug-in — on the assumption that the folder
# name matched our plug-in id. It does not, and upstream's code in a real vault
# was overwritten repeatedly before anyone noticed.
#
# So nothing here is typed by hand:
#
#   - the destination folder is the `id` from manifest.json, never an argument;
#   - a destination that already holds a different plug-in is refused, so a
#     folder belonging to something else can never be written into;
#   - the development vault is the default, and the real vault is refused
#     outright.
#
# Usage:  scripts/install-local.sh [vault-path]

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEFAULT_VAULT="$HOME/obsidian-fsx-test"
# The real vault. This fork is not installed here; it runs upstream's plug-in.
FORBIDDEN_VAULT="$HOME/obsidian"

VAULT="${1:-$DEFAULT_VAULT}"

die() {
    printf 'install-local: %s\n' "$1" >&2
    exit 1
}

# Resolved before comparing, so `~/obsidian/../obsidian` and a symlink pointing
# at the real vault are both caught.
resolve() {
    if [ -d "$1" ]; then
        (cd "$1" && pwd -P)
    else
        printf '%s\n' "$1"
    fi
}

VAULT="$(resolve "$VAULT")"
FORBIDDEN_RESOLVED="$(resolve "$FORBIDDEN_VAULT")"

[ -d "$VAULT/.obsidian" ] || die "$VAULT is not an Obsidian vault (no .obsidian directory)."

case "$VAULT" in
"$FORBIDDEN_RESOLVED" | "$FORBIDDEN_RESOLVED"/*)
    die "refusing to install into $FORBIDDEN_VAULT. That vault runs the upstream plug-in; this fork is developed in $DEFAULT_VAULT."
    ;;
esac

PLUGIN_ID="$(node -p "require('$REPO_ROOT/manifest.json').id")"
[ -n "$PLUGIN_ID" ] || die "manifest.json has no id."

DEST="$VAULT/.obsidian/plugins/$PLUGIN_ID"

# The check that was missing. A folder is ours only if the manifest already in
# it says so; anything else is another plug-in's, whatever the folder is called.
if [ -f "$DEST/manifest.json" ]; then
    EXISTING_ID="$(node -p "require('$DEST/manifest.json').id")"
    [ "$EXISTING_ID" = "$PLUGIN_ID" ] ||
        die "$DEST holds the plug-in '$EXISTING_ID', not '$PLUGIN_ID'. Refusing to overwrite it."
fi

for file in main.js manifest.json styles.css; do
    [ -f "$REPO_ROOT/$file" ] || die "$file is missing. Run 'npm run build' first."
done

mkdir -p "$DEST"
# data.json is the vault's own configuration and is never written here.
for file in main.js manifest.json styles.css; do
    cp "$REPO_ROOT/$file" "$DEST/$file"
done

printf 'Installed %s %s into %s\n' \
    "$PLUGIN_ID" "$(node -p "require('$REPO_ROOT/manifest.json').version")" "$DEST"
printf 'Reload Obsidian, or disable and re-enable the plug-in, to pick it up.\n'
