# Tutorial: using pi-evo-research in pi

This guide shows how to initialize, run, and configure `pi-evo-research` from inside pi. It assumes the extension and skills are installed.

## 1. Pick an optimization target

Before starting, decide:

- **Objective**: what should improve, e.g. runtime, memory, bundle size, test speed.
- **Benchmark command**: reproducible command that measures the target.
- **Primary metric**: one numeric metric to optimize, with direction (`lower` or `higher`).
- **Secondary metrics**: correctness, memory, size, phase timings, or other tradeoffs.
- **Files in scope**: files the agent may modify.
- **Off limits**: generated files, artifacts from other tools, unrelated code, credentials, data sets.
- **Constraints**: tests/checks that must pass, dependency policy, compatibility requirements.

Best results come from a fast benchmark that emits stable numbers. For noisy benchmarks, run the workload several times and report the median.

## 2. Start pi in the target project

```bash
cd /path/to/project
pi
```

Start the skill:

```text
/skill:pi-evo-research-create
```

Or ask directly:

```text
Run evo-research to optimize <target>. Primary metric is <metric>, <lower|higher> is better. Use <benchmark command>. Keep <checks/constraints> passing.
```

The skill should create the session files, initialize the experiment, run the baseline, log it, and continue the loop.

## 3. What the skill creates

Typical files in the project root:

| File | Purpose |
|---|---|
| `evo-research.md` | Durable session plan: objective, metrics, scope, constraints, tried ideas |
| `evo-research.sh` | Executable benchmark script; must print `METRIC name=value` lines |
| `evo-research.checks.sh` | Optional executable correctness checks run after passing benchmarks |
| `evo-research.jsonl` | Append-only experiment log |
| `evo-research.population.json` | Population state for candidate families, elites, novelty, stagnation |
| `evo-research.ideas.md` | Optional backlog of future hypotheses |
| `evo-research.hooks/` | Optional before/after automation hooks |

Generated shell scripts should be executable before the agent invokes them:

```bash
chmod +x evo-research.sh
# if present:
chmod +x evo-research.checks.sh
```

`run_experiment` also applies `chmod +x` to these files before invocation as a safety net.

## 4. Benchmark script requirements

`evo-research.sh` should:

1. fail fast on setup/build errors,
2. run the exact workload,
3. print one primary metric line matching the experiment metric name,
4. optionally print secondary metrics.

Example:

```bash
#!/bin/bash
set -euo pipefail

# Build or pre-check if needed.
make -j"$(nproc)" >/dev/null

start_ns=$(date +%s%N)
./your-command --benchmark-input >/dev/null
end_ns=$(date +%s%N)

total_ms=$(( (end_ns - start_ns) / 1000000 ))

echo "METRIC total_ms=$total_ms"
echo "METRIC correctness_pass=1"
```

For short/noisy workloads, run multiple samples and emit a median:

```text
METRIC total_ms=<median>
```

## 5. Correctness checks

If correctness matters, add `evo-research.checks.sh`:

```bash
#!/bin/bash
set -euo pipefail
make check >/dev/null
```

When present, checks run automatically after successful benchmarks. Mark the file executable with `chmod +x evo-research.checks.sh` after creating it. Check time does **not** count toward the primary metric. A result with failing checks must be logged as `checks_failed`, not `keep`.

## 6. Experiment lifecycle

The loop is:

```text
inspect code → choose candidate → edit → run benchmark → log result → keep/discard → update population → repeat
```

The tools used by the agent are:

| Tool | Role |
|---|---|
| `init_experiment` | Writes experiment config header: name, primary metric, unit, direction |
| `run_experiment` | Runs command, captures output, parses `METRIC` lines, applies checks |
| `log_experiment` | Logs result, commits kept changes, reverts rejected changes, updates population |

Result policy:

- `keep`: primary metric improved and checks passed.
- `discard`: primary metric was worse or unchanged.
- `crash`: benchmark/build failed.
- `checks_failed`: benchmark ran but correctness checks failed.

Important: `log_experiment` may auto-commit kept changes and auto-revert discarded/crashed changes. Start from a clean working tree unless you intentionally want all current changes managed by evo-research.

## 7. Population-guided search

`pi-evo-research` evolves hypotheses and patch strategies, not raw code strings.

Each experiment should log structured ASI metadata:

```json
{
  "candidate_id": "cand-cache-v2",
  "generation": 2,
  "family": "caching",
  "parent_id": "cand-cache-v1",
  "operator": "mutation",
  "hypothesis": "Cache repeated lookup results in the hot path",
  "genome": {
    "strategy": "memoization",
    "scope": ["src/hot-path.c"],
    "knobs": { "cache_size": 128 }
  },
  "outcome_learning": "Reduced repeated work but increased memory use",
  "next_mutation": "Try smaller bounded cache"
}
```

Common operators:

| Operator | Use |
|---|---|
| `seed` | New candidate family |
| `mutation` | Small variant of a promising candidate |
| `parameter_tune` | Change constants, thresholds, flags, or config |
| `specialization` | Add a narrower fast path |
| `simplification` | Preserve a gain while reducing complexity |
| `recombination` | Combine independent kept ideas with understood interactions |
| `novelty` | Try a different family after stagnation |

Population state is stored in `evo-research.population.json` and updated from logged results plus ASI.

## 8. Configuration

### `evo-research.config.json`

This optional file lives in the pi session working directory.

Supported fields:

```json
{
  "workingDir": "/path/to/project",
  "maxIterations": 50
}
```

- `workingDir`: project directory for evo-research files, commands, and git operations.
- `maxIterations`: maximum experiment runs before auto-stop.

If running pi from the project root, `workingDir` is usually unnecessary.

### Population scheduler settings

After initialization, edit `evo-research.population.json` to tune scheduling:

```json
{
  "scheduler": {
    "max_consecutive_family_failures": 3,
    "novelty_after_stagnation_runs": 5,
    "elite_limit": 3,
    "max_consecutive_family_attempts": 2,
    "explore_every_n_runs": 3,
    "generation_size": 10,
    "min_family_attempts_per_generation": 1
  }
}
```

Meaning:

- `max_consecutive_family_failures`: retire a family after this many consecutive failed runs.
- `novelty_after_stagnation_runs`: inject novelty after this many stagnant/non-improving runs.
- `elite_limit`: number of elite candidates considered for mutation.
- `max_consecutive_family_attempts`: force another active family after this many same-family attempts.
- `explore_every_n_runs`: deterministically explore a non-current active family on this cadence.
- `generation_size`: attempt count used for per-generation quota windows.
- `min_family_attempts_per_generation`: minimum attempts each active family should receive per generation window.

Defaults are conservative. For short A/B runs, a more aggressive schedule can help:

```json
{
  "scheduler": {
    "max_consecutive_family_failures": 2,
    "novelty_after_stagnation_runs": 4,
    "elite_limit": 3,
    "max_consecutive_family_attempts": 2,
    "explore_every_n_runs": 3,
    "generation_size": 10,
    "min_family_attempts_per_generation": 1
  }
}
```

### Scheduler behavior

The built-in scheduler is deterministic. It recommends, in order:

1. untried active families before elite mutation,
2. novelty after the stagnation threshold,
3. another active family after a same-family attempt streak,
4. under-quota families within the current generation window,
5. interval-based exploration,
6. otherwise, mutation of the best non-retired elite.

Current model:

```text
1 iteration = 1 candidate experiment
```

Use `maxIterations` plus `generation_size` for generation-style runs. For project-specific policies beyond this deterministic scheduler, use hooks.

## 9. Hooks for custom policy

Hooks are optional. Use them when you need custom automation such as external research fetching, anti-thrash rules, notifications, or custom candidate scheduling.

Hook locations:

```text
evo-research.hooks/before.sh
evo-research.hooks/after.sh
```

Built-in population scheduling already exists. Hook examples in the skill directory can be copied and adapted if you want editable shell equivalents or custom overrides.

## 10. Resuming a session

From the same project:

```bash
cd /path/to/project
pi
```

Then:

```text
/evo-research resume this session
```

The agent should read:

- `evo-research.md`,
- `evo-research.jsonl`,
- `evo-research.population.json`,
- `evo-research.ideas.md` if present,
- recent git history.

Do not call `init_experiment` again unless the target benchmark, metric, or workload changes.

## 11. Finalizing results

When ready to review results, use the finalize skill:

```text
/skill:pi-evo-research-finalize
```

Or ask:

```text
Finalize evo-research into clean reviewable branches.
```

This helps separate kept experimental changes from logs and intermediate artifacts.

---

# A/B testing against pi-autoresearch

Use this section when comparing `pi-evo-research` with an existing `pi-autoresearch` run.

## A/B goal

Make the comparison defensible:

- same project,
- same baseline commit or clearly documented baseline delta,
- same workload,
- same primary metric and direction,
- same correctness checks,
- same run budget or wall-clock budget,
- separate artifacts so neither tool overwrites the other.

## 1. Preserve `pi-autoresearch` artifacts

In the target project:

```bash
cd /path/to/project

git status --short
git add autoresearch.md autoresearch.sh autoresearch.jsonl autoresearch.ideas.md
git commit -m "Preserve pi-autoresearch artifacts before evo-research"
git tag autoresearch-before-evo-$(date +%Y%m%d-%H%M)
```

If you do not want to commit, at least back up the files:

```bash
mkdir -p ~/tmp/project-autoresearch-backup
cp -a autoresearch.* ~/tmp/project-autoresearch-backup/
```

Commit/tag is preferred because `log_experiment` may auto-revert uncommitted repository changes after discarded or crashed evo-research runs.

## 2. Create an isolated evo-research branch

```bash
git checkout -b evo-research/ab-test
```

Confirm clean state:

```bash
git status --short --branch
```

## 3. Start evo-research with explicit off-limits files

```bash
pi
```

Prompt:

```text
Run evo-research as an A/B test against the previous pi-autoresearch run.
Use the same benchmark/workload, primary metric, direction, and correctness checks.
Do not modify autoresearch.* files.
Create the evo-research setup automatically using the skill.
Use population-guided mode with ASI metadata on every run.
```

`pi-evo-research` uses different artifact names:

```text
evo-research.md
evo-research.sh
evo-research.jsonl
evo-research.population.json
evo-research.ideas.md
```

These should not overwrite:

```text
autoresearch.md
autoresearch.sh
autoresearch.jsonl
autoresearch.ideas.md
```

## 4. Configure equal run budget

Example `evo-research.config.json`:

```json
{
  "maxIterations": 50
}
```

Use the same or justified equivalent budget as `pi-autoresearch`.

After `evo-research.population.json` appears, optionally tune scheduler for A/B:

```json
{
  "scheduler": {
    "max_consecutive_family_failures": 2,
    "novelty_after_stagnation_runs": 4,
    "elite_limit": 3,
    "max_consecutive_family_attempts": 2,
    "explore_every_n_runs": 3,
    "generation_size": 10,
    "min_family_attempts_per_generation": 1
  }
}
```

## 5. Compare results

Record:

- baseline commit for both runs,
- benchmark command,
- workload/input data,
- run budget,
- best `pi-autoresearch` metric,
- best `pi-evo-research` metric,
- correctness status,
- diff size/complexity,
- final commit(s) kept by each system.

Helpful commands:

```bash
git log --oneline --decorate --graph --all --max-count=40
grep '"status":"keep"' evo-research.jsonl || true
grep '"status":"keep"' autoresearch.jsonl || true
```

## 6. Claiming a better result

A fair claim should say:

```text
On <project> at baseline <commit>, using <workload> and <metric>,
pi-evo-research achieved <best_evo> vs pi-autoresearch <best_auto>
under <same budget/checks>. Correctness checks: <status>.
```

Avoid claiming a general win if:

- workloads differed,
- metric definitions differed,
- one run had more iterations/time,
- one run used different correctness constraints,
- improvements are within benchmark noise.
