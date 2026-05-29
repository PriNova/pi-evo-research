#!/usr/bin/env bash
# Update evo-research.population.json from the latest logged run.
# Uses ASI fields as candidate metadata; missing candidate_id gets cand-run-N fallback.

set -euo pipefail

readonly POPULATION_FILE="evo-research.population.json"

input="$(cat)"
cwd="$(jq -r '.cwd' <<<"$input")"
file="$cwd/$POPULATION_FILE"
run_json="$(jq -c '.run_entry' <<<"$input")"
session_json="$(jq -c '.session' <<<"$input")"

mkdir -p "$cwd"
if [ ! -s "$file" ]; then
  jq -n '{
    schema_version: 1,
    generation: 0,
    active_candidate_id: null,
    stagnation_runs: 0,
    candidates: [],
    families: [],
    scheduler: {
      max_consecutive_family_failures: 3,
      novelty_after_stagnation_runs: 5,
      elite_limit: 3
    }
  }' > "$file"
fi

tmp="$(mktemp)"

jq --argjson run "$run_json" --argjson session "$session_json" '
  def scheduler_defaults: {
    max_consecutive_family_failures: 3,
    novelty_after_stagnation_runs: 5,
    elite_limit: 3
  };
  def direction: if $session.direction == "higher" then "higher" else "lower" end;
  def status: if (["keep", "discard", "crash", "checks_failed"] | index($run.status)) then $run.status else "keep" end;
  def candidate_id: ($run.asi.candidate_id // "cand-run-\($run.run // 0)");
  def family_name: ($run.asi.family // "uncategorized");
  def metric: if ($run.metric | type) == "number" then $run.metric else null end;
  def run_number: if ($run.run | type) == "number" then $run.run else 0 end;
  def fitness_entry: {
    run: run_number,
    status: status,
    metric: metric,
    direction: direction,
    confidence: (if ($run.confidence | type) == "number" then $run.confidence else null end),
    timestamp: (if ($run.timestamp | type) == "number" then $run.timestamp else null end),
    description: ($run.description // "")
  };
  def new_candidate: {
    id: candidate_id,
    family: family_name,
    parent_id: ($run.asi.parent_id // null),
    operator: ($run.asi.operator // "seed"),
    hypothesis: ($run.asi.hypothesis // $run.description // ""),
    genome: ($run.asi.genome // null),
    status: (if ($run.asi.operator // "") == "novelty" then "novelty" else "active" end),
    fitness_history: [],
    last_result_ref: null,
    notes: (if $run.asi.candidate_id then [] else ["candidate_id missing in ASI; derived from run number"] end)
  };
  def new_family: {
    name: family_name,
    attempts: 0,
    failures: 0,
    keeps: 0,
    retired: false,
    consecutive_failures: 0
  };
  def ensure_shape:
    .schema_version = 1
    | .generation = ((.generation // 0) | numbers // 0)
    | .active_candidate_id = (.active_candidate_id // null)
    | .stagnation_runs = ((.stagnation_runs // 0) | numbers // 0)
    | .candidates = ((.candidates // []) | arrays // [])
    | .families = ((.families // []) | arrays // [])
    | .scheduler = (scheduler_defaults + (.scheduler // {}));
  def best_before:
    [ .candidates[].fitness_history[]? | select(.status == "keep" and (.metric | type) == "number") | .metric ]
    | if length == 0 then null elif direction == "higher" then max else min end;
  def update_candidate:
    .candidates = (
      if any(.candidates[]?; .id == candidate_id) then
        [ .candidates[] | if .id == candidate_id then
          .fitness_history = ((.fitness_history // []) + [fitness_entry])
          | .last_result_ref = run_number
          | .status = (if status == "keep" then "elite" elif .status == "retired" then "retired" else "failed" end)
        else . end ]
      else
        .candidates + [new_candidate | .fitness_history = [fitness_entry] | .last_result_ref = run_number | .status = (if status == "keep" then "elite" else "failed" end)]
      end
    );
  def update_family:
    .families = (
      if any(.families[]?; .name == family_name) then .families else .families + [new_family] end
    )
    | .families = [ .families[] | if .name == family_name then
        .attempts += 1
        | if status == "keep" then
            .keeps += 1 | .consecutive_failures = 0
          else
            .failures += 1 | .consecutive_failures += 1
          end
      else . end ];
  ensure_shape
  | (best_before) as $best_before
  | update_candidate
  | update_family
  | .active_candidate_id = candidate_id
  | .generation = ([.generation, ($run.asi.generation // .generation)] | map(select(type == "number")) | max)
  | .stagnation_runs = (
      if status == "keep" and metric != null and ($best_before == null or (direction == "higher" and metric > $best_before) or (direction == "lower" and metric < $best_before)) then 0
      else .stagnation_runs + 1 end
    )
  | (.families[] | select(.name == family_name) | .consecutive_failures) as $consecutive
  | if $consecutive >= .scheduler.max_consecutive_family_failures then
      .families = [ .families[] | if .name == family_name then .retired = true else . end ]
      | .candidates = [ .candidates[] | if .family == family_name and .status != "elite" then .status = "retired" else . end ]
    else . end
' "$file" > "$tmp"

mv "$tmp" "$file"

if ! jq -e '.run_entry.asi.candidate_id?' <<<"$input" >/dev/null; then
  echo "Population: ASI candidate_id missing; used cand-run-$(jq -r '.run_entry.run // 0' <<<"$input"). Include candidate_id, family, operator, hypothesis, genome."
  exit 0
fi

retired_family="$(jq -r --arg family "$(jq -r '.run_entry.asi.family // "uncategorized"' <<<"$input")" '.families[]? | select(.name == $family and .retired == true) | .name' "$file" | head -1)"
[ -z "$retired_family" ] && exit 0

echo "Population: retired family $retired_family after repeated failed runs. Try a different family or novelty candidate."
