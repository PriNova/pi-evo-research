#!/usr/bin/env bash
# Recommend the next population candidate from evo-research.population.json.
# Deterministic policy: novelty after stagnation, otherwise mutate best non-retired elite.

set -euo pipefail

readonly POPULATION_FILE="evo-research.population.json"

input="$(cat)"
cwd="$(jq -r '.cwd' <<<"$input")"
file="$cwd/$POPULATION_FILE"
session_json="$(jq -c '.session' <<<"$input")"

if [ ! -s "$file" ]; then
  echo "Population: seed diverse candidate families. ASI: include candidate_id, family, operator, hypothesis, genome."
  exit 0
fi

if ! jq empty "$file" >/dev/null 2>&1; then
  echo "Population: $POPULATION_FILE is invalid JSON; inspect or remove it before relying on scheduler state."
  exit 0
fi

jq -r --argjson session "$session_json" '
  def direction: if $session.direction == "higher" then "higher" else "lower" end;
  def scheduler: {
    max_consecutive_family_failures: 3,
    novelty_after_stagnation_runs: 5,
    elite_limit: 3
  } + (.scheduler // {});
  def retired_families: [ .families[]? | select(.retired == true) | .name ];
  def best_metric($candidate):
    [ $candidate.fitness_history[]? | select(.status == "keep" and (.metric | type) == "number") | .metric ]
    | if length == 0 then null elif direction == "higher" then max else min end;
  def family_retired($name): any(.families[]?; .name == $name and .retired == true);
  def elite_rows:
    [ .candidates[]?
      | select(.status == "elite")
      | select(family_retired(.family) | not)
      | {id, family, metric: best_metric(.)}
      | select(.metric != null)
    ];
  def best_elite:
    elite_rows | sort_by(.metric) | if direction == "higher" then reverse else . end | .[0];
  def avoid_text:
    (retired_families | sort | join(", ")) as $avoid
    | if $avoid == "" then "" else "\nAvoid: " + $avoid + "; retired after repeated failed runs." end;
  if ((.stagnation_runs // 0) >= (scheduler.novelty_after_stagnation_runs // 5)) then
    "Next: inject novelty; " + ((.stagnation_runs // 0) | tostring) + " stagnant runs reached threshold.\nASI: include candidate_id, family, operator, hypothesis, genome." + avoid_text
  elif (best_elite != null) then
    (best_elite) as $elite
    | "Next: mutate " + $elite.id + " in family " + $elite.family + "; keep benchmark as source of truth.\nASI: include parent_id=\"" + $elite.id + "\", family=\"" + $elite.family + "\", operator=\"mutation\"." + avoid_text
  else
    "Next: seed a structurally different candidate family; no non-retired elite exists.\nASI: include candidate_id, family, operator, hypothesis, genome." + avoid_text
  end
' "$file"
