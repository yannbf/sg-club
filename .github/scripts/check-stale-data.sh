#!/usr/bin/env bash
#
# Decides which of this workflow's data jobs are overdue.
#
# GitHub delays scheduled events under load and drops them outright when the
# queue is congested, so a job's own cron is not a dependable trigger: observed
# drift reached 5h on the daily playtime cron, and the hourly challenge cron
# lands 10-15 times a day instead of 24. Every scheduled fire therefore
# re-checks all datasets here and revives whichever have gone stale, which
# bounds staleness to the gap between fires rather than to the cron period.
#
# The result is purely additive — each job still runs on its own cron, and these
# outputs only ever add a catch-up run on top.
#
# A job is overdue when it has not succeeded since its most recent scheduled
# slot. Comparing against the slot rather than against an elapsed-time budget
# matters in both directions: a budget wide enough not to double-run a punctual
# job (>1 cron period) would also inherit the previous run's delay and compound
# it, while a narrower one would re-run a job that had just finished.
#
# Freshness comes from the Actions API (last successful run of the job) rather
# than from the data's commit timestamp, because a job that legitimately found
# nothing to change makes no commit and would otherwise look stale forever and
# re-run on every fire. The biweekly wishlist runs less often than the scan
# window reaches, so it falls back to the last commit touching its own data.
set -euo pipefail

REPO="${GITHUB_REPOSITORY}"
WORKFLOW="deploy.yml"
SCAN_RUNS=30
NOW=$(date -u +%s)

emit() {
  echo "$1=$2" >>"$GITHUB_OUTPUT"
  printf '  %-18s %s\n' "$1" "$2"
}

all_false() {
  for key in website playtime wishlist challenge challenge_all verification; do
    emit "${key}_due" false
  done
}

# Only scheduled fires do catch-up. A workflow_dispatch or push asked for one
# specific thing and must keep doing exactly that.
if [[ "${GITHUB_EVENT_NAME}" != "schedule" ]]; then
  echo "event=${GITHUB_EVENT_NAME} — no staleness catch-up"
  all_false
  exit 0
fi

# Fail closed. Marking everything due on an API blip would launch every heavy
# job at once and collide on SteamGifts' rate limit; skipping catch-up just
# degrades to the cron-only behaviour this script is layered on top of.
if ! run_ids=$(gh api "repos/$REPO/actions/workflows/$WORKFLOW/runs?per_page=$SCAN_RUNS" \
                 --jq '.workflow_runs[].id' 2>&1); then
  echo "::warning::Could not list workflow runs — skipping staleness catch-up"
  echo "$run_ids"
  all_false
  exit 0
fi

# Most recent successful completion per job name.
declare -A last_run=()
while read -r id; do
  [[ -z "$id" ]] && continue
  jobs_tsv=$(gh api "repos/$REPO/actions/runs/$id/jobs" \
               --jq '.jobs[] | select(.conclusion=="success") | [.name, .completed_at] | @tsv' 2>/dev/null || true)
  while IFS=$'\t' read -r name completed; do
    [[ -z "$name" || -z "$completed" ]] && continue
    ts=$(date -u -d "$completed" +%s 2>/dev/null || echo 0)
    if (( ts > ${last_run[$name]:-0} )); then last_run[$name]=$ts; fi
  done <<<"$jobs_tsv"
done <<<"$run_ids"

# Most recent daily slot at or before NOW minus grace, over the given hours.
# The grace period keeps catch-up from racing a fire that GitHub is merely
# running late, which would run the job twice.
daily_slot() {
  local minute=$1 grace=$2; shift 2
  local cutoff=$((NOW - grace * 60)) best=0 day hour ts base
  for day in 0 1; do
    base=$(date -u -d "-${day} day" +%Y-%m-%d)
    for hour in "$@"; do
      ts=$(date -u -d "${base} ${hour}:${minute}:00" +%s)
      if (( ts <= cutoff && ts > best )); then best=$ts; fi
    done
  done
  echo "$best"
}

# Same, for the 1st/15th crons: the last such slot in this month or the one
# before, so a dropped slot is still recovered well into the following weeks.
monthly_slot() {
  local minute=$1 grace=$2 hour=$3
  local cutoff=$((NOW - grace * 60)) best=0 month day ts ym
  for month in 0 1; do
    # Anchored on the 1st: "-1 month" from a 29th-31st lands back inside the
    # same month in GNU date, which would silently drop the previous month.
    ym=$(date -u -d "$(date -u +%Y-%m-01) -${month} month" +%Y-%m)
    for day in 01 15; do
      ts=$(date -u -d "${ym}-${day} ${hour}:${minute}:00" +%s 2>/dev/null) || continue
      if (( ts <= cutoff && ts > best )); then best=$ts; fi
    done
  done
  echo "$best"
}

when() { (( $1 == 0 )) && echo never || date -u -d "@$1" '+%m-%d %H:%M'; }

# Overdue when the job has not succeeded since its most recent slot. A job
# missing from the scan window has not run in ~2 days, so its 0 timestamp
# correctly reports as overdue for every schedule here.
due_since_slot() {
  local job=$1 slot=$2 last=${last_run[$1]:-0}
  printf '  %-18s last success %s | slot %s\n' "$job" "$(when "$last")" "$(when "$slot")" >&2
  (( last < slot )) && echo true || echo false
}

emit website_due      "$(due_since_slot website-data "$(daily_slot 15 45 0 8 16)")"
emit playtime_due     "$(due_since_slot playtime     "$(daily_slot 30 45 1)")"
emit verification_due "$(due_since_slot verification "$(daily_slot 20 45 1 9 17)")"
emit challenge_due    "$(due_since_slot challenge    "$(daily_slot 25 20 $(seq -s' ' 0 23))")"

# The wishlist scrape is biweekly, so it runs less often than the scan window
# reaches back; its own data file's last commit is the fallback freshness.
wishlist_ts=${last_run[wishlist]:-0}
commit_iso=$(gh api "repos/$REPO/commits?path=packages/website/public/data/wishlist.json&per_page=1" \
               --jq '.[0].commit.committer.date // empty' 2>/dev/null || true)
if [[ -n "$commit_iso" ]]; then
  commit_ts=$(date -u -d "$commit_iso" +%s 2>/dev/null || echo 0)
  (( commit_ts > wishlist_ts )) && wishlist_ts=$commit_ts
fi
wishlist_slot=$(monthly_slot 15 45 6)
printf '  %-18s last refresh %s | slot %s\n' wishlist "$(when "$wishlist_ts")" "$(when "$wishlist_slot")" >&2
emit wishlist_due "$( (( wishlist_ts < wishlist_slot )) && echo true || echo false )"

# Dormant challenges refresh on the 1st and 15th. The API cannot distinguish a
# dormant-inclusive challenge run from a normal one, so this instead fires on
# the first challenge run after that slot — which, at hourly cadence, is the
# same thing and self-clears once that run lands.
challenge_all_slot=$(monthly_slot 40 45 6)
emit challenge_all_due \
  "$( (( ${last_run[challenge]:-0} < challenge_all_slot )) && echo true || echo false )"
