#!/usr/bin/env bash
# Prints the text of the README download badge (e.g. "2.7k") for owner/repo, or nothing when
# GitHub can't be read. It counts the release files people get (installers, update bundles,
# extensions), not latest.json, which every running Prism fetches on each update check, or
# SHA256SUMS.txt. Needs gh with GH_TOKEN (or a gh login).
#
#   bash scripts/downloads-badge.sh SMOKEx2/Zelux-DL
#
# Used by .github/workflows/pages.yml (writes site/downloads.json) and badge-refresh.yml
# (redeploys the site when the published text is out of date).
set -uo pipefail
repo=${1:?usage: downloads-badge.sh owner/repo}

total=$(gh api --paginate "repos/${repo}/releases?per_page=100" \
  --jq '[.[].assets[] | select(.name != "latest.json" and .name != "SHA256SUMS.txt") | .download_count] | add // 0' \
  | awk '{ s += $1 } END { print s + 0 }') || exit 0
[ "${total:-0}" -gt 0 ] || exit 0

awk -v n="$total" 'BEGIN {
  if (n < 1000) { printf "%d\n", n }
  else if (n < 10000) { s = sprintf("%.1f", n / 1000); sub(/\.0$/, "", s); printf "%sk\n", s }
  else if (n < 1000000) { printf "%dk\n", int(n / 1000) }
  else { s = sprintf("%.1f", n / 1000000); sub(/\.0$/, "", s); printf "%sM\n", s }
}'
