#!/usr/bin/env bash
# Production deploy for northeside.netlify.app (audit 27 Nov, S3).
#
# Builds exactly one pushed commit and nothing else:
#   - refuses a dirty working tree, or a HEAD that is not on origin/main;
#   - with GITHUB_TOKEN set, refuses a commit whose CI run has not succeeded;
#   - always runs typecheck and the unit tests locally;
#   - takes every NEXT_PUBLIC_* value from Netlify's production environment, never from this shell,
#     so a missing or stale local variable cannot ship a wrong bundle;
#   - stamps the deploy with the commit hash.
#
# Needs: NETLIFY_AUTH_TOKEN, NETLIFY_ACCOUNT_ID, NETLIFY_SITE_ID. Optional: GITHUB_TOKEN, GITHUB_REPO
# (owner/name, default linoxbt/Northeside), SKIP_TESTS=1 (only after the same commit passed CI).
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

: "${NETLIFY_AUTH_TOKEN:?set NETLIFY_AUTH_TOKEN}"
: "${NETLIFY_ACCOUNT_ID:?set NETLIFY_ACCOUNT_ID}"
: "${NETLIFY_SITE_ID:?set NETLIFY_SITE_ID}"
REPO="${GITHUB_REPO:-linoxbt/Northeside}"

if [ -n "$(git status --porcelain)" ]; then
  echo "deploy: the working tree has uncommitted changes; commit or stash them first" >&2
  exit 1
fi
git fetch -q origin main
SHA="$(git rev-parse HEAD)"
if ! git merge-base --is-ancestor "$SHA" origin/main; then
  echo "deploy: $SHA is not on origin/main; push it first" >&2
  exit 1
fi

if [ -n "${GITHUB_TOKEN:-}" ]; then
  conclusion="$(curl -fsS -H "Authorization: Bearer $GITHUB_TOKEN" -H "Accept: application/vnd.github+json" \
    "https://api.github.com/repos/$REPO/actions/runs?head_sha=$SHA&per_page=20" |
    node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const r=JSON.parse(s).workflow_runs.filter(w=>w.name==="CI");console.log(r.length?`${r[0].status}/${r[0].conclusion}`:"none")})')"
  if [ "$conclusion" != "completed/success" ]; then
    echo "deploy: CI for $SHA is '$conclusion', not completed/success" >&2
    exit 1
  fi
  echo "deploy: CI passed for $SHA"
fi

if [ "${SKIP_TESTS:-0}" != "1" ]; then
  pnpm typecheck
  pnpm test
  pnpm -C apps/web exec vitest run
fi

# Public build-time values come from Netlify, not from this shell.
unset $(env | grep -o '^NEXT_PUBLIC_[A-Z0-9_]*' || true)
PUBENV="$(mktemp)"
trap 'rm -f "$PUBENV"' EXIT
curl -fsS -H "Authorization: Bearer $NETLIFY_AUTH_TOKEN" \
  "https://api.netlify.com/api/v1/accounts/$NETLIFY_ACCOUNT_ID/env?site_id=$NETLIFY_SITE_ID" |
  node -e '
    let s = ""; process.stdin.on("data", (d) => (s += d)).on("end", () => {
      for (const e of JSON.parse(s)) {
        if (!e.key.startsWith("NEXT_PUBLIC_")) continue;
        const v = (e.values.find((x) => x.context === "production") ?? e.values.find((x) => x.context === "all"))?.value;
        if (v) console.log(`${e.key}=${JSON.stringify(v)}`);
      }
    });' > "$PUBENV"
echo "deploy: $(wc -l < "$PUBENV") NEXT_PUBLIC_* values from Netlify"
set -a; . "$PUBENV"; set +a

# The CLI finds the site through apps/web/.netlify/state.json; NETLIFY_SITE_ID in its environment makes
# it fail with "Project not found", so it is hidden from the CLI.
env -u NETLIFY_SITE_ID npx netlify build --offline --context production --filter @northeside/web
MSG="$(git log -1 --format='%h %s' | cut -c1-120)"
for attempt in 1 2 3 4 5; do
  if env -u NETLIFY_SITE_ID npx netlify deploy --prod --no-build --skip-functions-cache --filter @northeside/web \
    --dir apps/web/.netlify/static --message "$MSG"; then
    echo "deploy: $SHA is live"
    exit 0
  fi
  echo "deploy: upload attempt $attempt failed; retrying" >&2
  sleep 8
done
echo "deploy: upload failed 5 times" >&2
exit 1
