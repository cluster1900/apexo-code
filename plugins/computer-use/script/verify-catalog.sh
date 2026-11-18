#!/bin/sh
set -eu

plugin=$(CDPATH='' cd -- "$(/usr/bin/dirname -- "$0")/.." && /bin/pwd -P)
catalog="$plugin/catalog/.grok-plugin"
url=https://github.com/cluster1900/apexo-skills.git
entry=$(jq -cer '.plugins[] | select(.name == "computer-use")' "$catalog/marketplace.json")
sha=$(printf '%s' "$entry" | jq -er --arg url "$url" '
  select(.source.type == "git" and .source.url == $url and .source.path == "computer-use")
  | .source.sha | select(test("^[a-f0-9]{40}$"))
')
version=$(printf '%s' "$entry" | jq -er '.version')
jq -e --arg sha "$sha" --arg version "$version" '
  .plugins["computer-use"] | .sha == $sha and .version == $version
' "$catalog/plugin-index.json" >/dev/null

checkout=$(mktemp -d)
trap 'rm -rf "$checkout"' EXIT
git -C "$checkout" init -q
git -C "$checkout" fetch --no-tags --depth 1 "$url" "$sha"
git -C "$checkout" -c core.hooksPath=/dev/null checkout -q --detach FETCH_HEAD
test "$(git -C "$checkout" rev-parse HEAD)" = "$sha"

cd "$checkout/computer-use"
jq -e --arg version "$version" '.name == "computer-use" and .version == $version' .claude-plugin/plugin.json >/dev/null
shasum -a 256 -c SHA256SUMS
test -x bin/mcp
for arch in arm64 x64; do
  test -x "bin/$arch/mcp"
  test -x "bin/$arch/agent-desktop"
  test -x "bin/$arch/agent-desktop-macos-helper"
done
