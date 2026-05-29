---
name: pi-evo-research-create
description: Set up and run a population-guided autonomous experiment loop for any optimization target. Gathers what to optimize, then starts the loop immediately. Use when asked to "run evo-research", "run pi-evo-research", "optimize X in a loop", "set up evolutionary search", or "start experiments".
---

# Evo Research

Population-guided autonomous experiment loop: maintain candidate hypotheses, try measured variants, keep what works, discard what doesn't, never stop.

## Tools

- **`init_experiment`** — configure session (name, metric, unit, direction). Call again to re-initialize with a new baseline when the optimization target changes.
- **`run_experiment`** — runs command, times it, captures output.
- **`log_experiment`** — records result. `keep` auto-commits. `discard`/`crash`/`checks_failed` auto-reverts code changes (evo-research files preserved). Always include secondary `metrics` dict. Dashboard: ctrl+shift+t.

## Setup

1. Ask (or infer): **Goal**, **Command**, **Metric** (+ direction), **Files in scope**, **Constraints**.
2. `git checkout -b evo-research/<goal>-<date>`
3. Read the source files. Understand the workload deeply before writing anything.
4. Write `evo-research.md` and `evo-research.sh` (see below). Commit both.
5. For broad, noisy, or multi-knob tasks, optionally enable population hooks so `evo-research.population.json` can guide candidate scheduling.
6. `init_experiment` → run baseline → `log_experiment` → start looping immediately.

### `evo-research.md`

This is the heart of the session. A fresh agent with no context should be able to read this file and run the loop effectively. Invest time making it excellent.

```markdown
# Evo Research: <goal>

## Objective
<Specific description of what we're optimizing and the workload.>

## Metrics
- **Primary**: <name> (<unit>, lower/higher is better) — the optimization target
- **Secondary**: <name>, <name>, ... — independent tradeoff monitors

## How to Run
`./evo-research.sh` — outputs `METRIC name=number` lines.

## Files in Scope
<Every file the agent may modify, with a brief note on what it does.>

## Off Limits
<What must NOT be touched.>

## Constraints
<Hard rules: tests must pass, no new deps, etc.>

## What's Been Tried
<Update this section as experiments accumulate. Note key wins, dead ends,
and architectural insights so the agent doesn't repeat failed approaches.>
```

Update `evo-research.md` periodically — especially the "What's Been Tried" section — so resuming agents have full context.

### `evo-research.sh`

Bash script (`set -euo pipefail`) that: pre-checks fast (syntax errors in <1s), runs the benchmark, and outputs structured lines to stdout. Keep the script fast — every second is multiplied by hundreds of runs.

**For fast, noisy benchmarks** (< 5s), run the workload multiple times inside the script and report the median. This produces stable data points and makes the confidence score reliable from the start. Slow workloads (ML training, large builds) don't need this — single runs are fine.

#### Structured output

- `METRIC name=value` — primary metric (must match `init_experiment`'s `metric_name`) and any secondary metrics. Parsed automatically by `run_experiment`.

#### Design the script to inform optimization

The script should output **whatever data helps you make better decisions in the next iteration.** Think about what you'll need to see after each run to know where to focus:

- Phase timings when the workload has distinct stages
- Error counts, failure categories, or test names when checks can fail in different ways
- Memory usage, cache hit rates, or other runtime diagnostics when relevant
- Anything domain-specific that would help localize regressions or identify bottlenecks

The script runs the same code every iteration — but you can **update it during the loop** if you discover you need more signal. Add instrumentation as you learn what matters.

#### Agent-supplied ASI via `log_experiment`

Use `log_experiment`'s `asi` parameter to annotate each run with **whatever would help the next iteration make a better decision.** Free-form key/value pairs — you decide what's worth recording. Don't repeat the description or raw output; capture what you'd lose after a context reset.

For population-guided runs, include these ASI fields whenever possible: `candidate_id`, `generation`, `family`, `parent_id`, `operator`, `hypothesis`, `genome`, `outcome_learning`, `next_mutation`. The population hooks use them to update `evo-research.population.json` without a new tool contract.

**Annotate failures and crashes heavily.** Discarded and crashed runs are reverted — the code changes are gone. The only record that survives is the description and ASI in `evo-research.jsonl`. If you don't capture what you tried and why it failed, future iterations will waste time re-discovering the same dead ends.

### `evo-research.config.json` (optional)

JSON config file that lives in the pi session's working directory (`ctx.cwd`). Supported fields:

- **`maxIterations`** (number) — maximum experiments before auto-stopping.
- **`workingDir`** (string) — override the directory for all evo-research operations: file I/O (`evo-research.jsonl`, `evo-research.md`, `evo-research.sh`, `evo-research.checks.sh`, `evo-research.ideas.md`), command execution, and git operations. Supports absolute paths or relative paths (resolved against `ctx.cwd`). The config file itself always stays in `ctx.cwd`. Fails if the directory doesn't exist.

```json
{
  "workingDir": "/path/to/project",
  "maxIterations": 50
}
```

### `evo-research.checks.sh` (optional)

Bash script (`set -euo pipefail`) for backpressure/correctness checks: tests, types, lint, etc. **Only create this file when the user's constraints require correctness validation** (e.g., "tests must pass", "types must check").

When this file exists:
- Runs automatically after every **passing** benchmark in `run_experiment`.
- If checks fail, `run_experiment` reports it clearly — log as `checks_failed`.
- Its execution time does **NOT** affect the primary metric.
- You cannot `keep` a result when checks have failed.
- Has a separate timeout (default 300s, configurable via `checks_timeout_seconds`).

When this file does **not** exist, everything behaves exactly as before — no changes to the loop.

**Keep output minimal.** Only the last 80 lines of checks output are fed back to the agent on failure. Suppress verbose progress/success output and let only errors through. This keeps context lean and helps the agent pinpoint what broke.

```bash
#!/bin/bash
set -euo pipefail
# Example: run tests and typecheck — suppress success output, only show errors
pnpm test --run --reporter=dot 2>&1 | tail -50
pnpm typecheck 2>&1 | grep -i error || true
```

## Loop Rules

**LOOP FOREVER.** Never ask "should I continue?" — the user expects autonomous work.

- **Primary metric is king.** Improved → `keep`. Worse/equal → `discard`. Secondary metrics rarely affect this.
- **Annotate every run with `asi`.** Record what you learned — not what you did. Include evolutionary metadata when useful: `candidate_id`, `generation`, `family`, `parent_id`, `operator`, `hypothesis`, `genome`, `outcome_learning`, `next_mutation`.
- **Watch the confidence score.** After 3+ runs, `log_experiment` reports a confidence score (best improvement as a multiple of the session noise floor). ≥2.0× means the improvement is likely real. <1.0× means it's within noise — consider re-running to confirm before keeping. The score is advisory — it never auto-discards.
- **Simpler is better.** Removing code for equal perf = keep. Ugly complexity for tiny gain = probably discard.
- **Don't thrash.** Repeatedly reverting the same idea? Try something structurally different. Do not spend more than a few consecutive runs in one failing candidate family.
- **Crashes:** fix if trivial, otherwise log and move on. Don't over-invest.
- **Think longer when stuck.** Re-read source files, study the profiling data, reason about what the CPU is actually doing. The best ideas come from deep understanding, not from trying random variations.
- **Resuming:** if `evo-research.md` exists, read it + git log, continue looping.

**NEVER STOP.** The user may be away for hours. Keep going until interrupted.

## Evolutionary Mode

Use evolutionary mode for broad, noisy, or multi-knob optimization tasks. Evolve hypotheses and patch strategies, not raw code strings.

Maintain a small population of candidate families in `evo-research.ideas.md`, `asi`, and, for longer runs, `evo-research.population.json`:

- **Seed** diverse candidates from source reading, profiling, and domain knowledge.
- **Evaluate** one candidate per experiment against the global primary metric.
- **Select** kept candidates with passing checks, meaningful improvement, and acceptable complexity.
- **Mutate** promising candidates with small variants or parameter changes; when population hooks are enabled, follow `before.sh` steer messages unless repo evidence says they are stale.
- **Simplify** winners after gains are found.
- **Recombine** only independent kept ideas with understood interactions; never do textual code crossover.
- **Inject novelty** after stagnation or repeated failures in one family. The population scheduler does this deterministically after its configured stagnation threshold.

Candidate ASI example:

```json
{
  "candidate_id": "cand-cache-parser-v2",
  "generation": 2,
  "family": "caching",
  "parent_id": "cand-cache-parser-v1",
  "operator": "mutation",
  "hypothesis": "Cache parser output by file content hash",
  "genome": {
    "strategy": "memoization",
    "scope": ["src/parser.ts"],
    "knobs": { "cache_key": "content_hash" }
  },
  "outcome_learning": "Reduced parse time but increased memory use",
  "next_mutation": "Try bounded cache or reuse buffer"
}
```

Important: decompose solution space into candidate families, but evaluate against the global objective. Sub-task wins do not count unless the end-to-end metric improves.

## Ideas Backlog

When you discover complex but promising optimizations that you won't pursue right now, **append them as bullets to `evo-research.ideas.md`**. Don't let good ideas get lost.

On resume (context limit, crash), check `evo-research.ideas.md` — prune stale/tried entries, experiment with the rest. When all paths are exhausted, delete the file and write a final summary.

## User Messages During Experiments

If the user sends a message while an experiment is running, finish the current `run_experiment` + `log_experiment` cycle first, then incorporate their feedback in the next iteration. Don't abandon a running experiment.
