#!/usr/bin/env bash
# Recommend the next population candidate from evo-research.population.json.
# Deterministic policy mirrors the built-in extension scheduler:
# untried family -> novelty -> family-streak break -> generation quota ->
# interval exploration -> best non-retired elite.

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
    elite_limit: 3,
    max_consecutive_family_attempts: 2,
    explore_every_n_runs: 3,
    generation_size: 10,
    min_family_attempts_per_generation: 1
  } + (.scheduler // {});
  def retired_families: [ .families[]? | select(.retired == true) | .name ];
  def active_families: [ .families[]? | select(.retired != true) ] | sort_by(.attempts, .failures, .name);
  def history: [ .candidates[]? as $c | $c.fitness_history[]? | {run, family: $c.family} ] | sort_by(.run);
  def last_family: (history | last | .family) // null;
  def last_family_streak:
    (last_family) as $last
    | if $last == null then 0
      else
        reduce (history | reverse)[] as $attempt ({count: 0, done: false};
          if .done then .
          elif $attempt.family == $last then .count += 1
          else .done = true
          end
        ) | .count
      end;
  def total_attempts: [ .families[]?.attempts // 0 ] | add // 0;
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
  def elite_for_family($family):
    [ elite_rows[] | select(.family == $family) ]
    | sort_by(.metric) | if direction == "higher" then reverse else . end | .[0];
  def avoid_text:
    (retired_families | sort | join(", ")) as $avoid
    | if $avoid == "" then "" else "\nAvoid: " + $avoid + "; retired after repeated failed runs." end;
  def explore_family($family; $reason):
    (elite_for_family($family.name)) as $elite
    | if $elite != null then
        "Next: " + $reason + "; explore family " + $family.name + " by mutating elite " + $elite.id + ".\nASI: include parent_id=\"" + $elite.id + "\", family=\"" + $family.name + "\", operator=\"mutation\"."
      else
        "Next: " + $reason + "; seed under-explored family " + $family.name + ".\nASI: include candidate_id, family=\"" + $family.name + "\", operator, hypothesis, genome."
      end;
  (active_families | map(select((.attempts // 0) == 0)) | .[0]) as $untried
  | (last_family) as $last
  | (active_families | map(select(.name != $last)) | .[0]) as $other_family
  | if $untried != null then
      explore_family($untried; "explore untried family before mutating elites") + avoid_text
    elif ((.stagnation_runs // 0) >= (scheduler.novelty_after_stagnation_runs // 5)) then
      "Next: inject novelty; " + ((.stagnation_runs // 0) | tostring) + " stagnant runs reached threshold.\nASI: include candidate_id, family, operator, hypothesis, genome." + avoid_text
    elif ($last != null and last_family_streak >= (scheduler.max_consecutive_family_attempts // 2) and $other_family != null) then
      explore_family($other_family; "explore another family; " + $last + " reached " + (last_family_streak | tostring) + " consecutive attempts") + avoid_text
    elif (total_attempts > 0 and (total_attempts % (scheduler.explore_every_n_runs // 3)) == 0 and ((active_families | length) > 0)) then
      explore_family(($other_family // active_families[0]); "deterministic exploration interval reached at attempt " + (total_attempts | tostring)) + avoid_text
    elif (best_elite != null) then
      (best_elite) as $elite
      | "Next: mutate " + $elite.id + " in family " + $elite.family + "; keep benchmark as source of truth.\nASI: include parent_id=\"" + $elite.id + "\", family=\"" + $elite.family + "\", operator=\"mutation\"." + avoid_text
    else
      "Next: seed a structurally different candidate family; no non-retired elite exists.\nASI: include candidate_id, family, operator, hypothesis, genome." + avoid_text
    end
' "$file"
