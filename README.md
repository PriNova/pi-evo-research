<div align="center">

# pi-evo-research
### Population-guided evolutionary research for coding agents

**[Install](#install)** · **[Usage](#usage)** · **[Evolutionary mode](#evolutionary-mode)** · **[Glossary](GLOSSARY.md)**

</div>

`pi-evo-research` helps a coding agent optimize software by running measured experiments, keeping improvements, discarding regressions, and maintaining a diverse population of candidate hypotheses.

It builds on David Cortés' [`pi-autoresearch`](https://github.com/davebcn87/pi-autoresearch), which adapts Andrej Karpathy's [`autoresearch`](https://github.com/karpathy/autoresearch) idea for pi. `pi-evo-research` adds a more explicit search policy: avoid pure hill-climbing, track candidate families, mutate promising ideas, retire dead ends, and inject novelty when progress stalls.

The core principle:

> Evolve hypotheses and patch strategies, not raw code strings.

---

## What is different?

Classic single-path research often behaves like local search:

```text
try idea → benchmark → keep/discard → try nearby idea
```

That works well until the agent gets stuck around a local optimum.

`pi-evo-research` encourages a population-based loop:

```text
seed candidate families → evaluate → select → mutate → recombine safe winners → inject novelty
```

The benchmark remains the source of truth. Evolution guides which experiment to try next.

---

## What's included

| Part | Purpose |
|---|---|
| **Pi extension** | Tools, session state, dashboard, run logging, keep/discard automation |
| **Evo research skill** | Sets up the optimization session and drives the population-guided autonomous loop |
| **Evolutionary mode** | Agent policy for population-guided search over hypotheses |
| **Hooks** | Optional before/after scripts for external scheduling, notes, and candidate steering |

### Extension tools

| Tool | Description |
|---|---|
| `init_experiment` | Configure session name, primary metric, unit, and direction |
| `run_experiment` | Run benchmark/check command, capture output, parse `METRIC name=value` lines |
| `log_experiment` | Record result, commit kept changes, revert rejected changes, persist ASI metadata |

### Command

| Command | Description |
|---|---|
| `/evo-research <text>` | Enter the autonomous optimization loop or resume an existing one |
| `/evo-research off` | Leave evo-research mode while preserving logs |
| `/evo-research clear` | Delete `evo-research.jsonl` and reset runtime state |
| `/evo-research export` | Open live dashboard in a browser |

The command name remains `/evo-research` for compatibility with the existing pi-evo-research workflow.

---

## Install

```bash
pi install npm:pi-evo-research
```

Manual local install while developing:

```bash
cp -r extensions/pi-evo-research ~/.pi/agent/extensions/
cp -r skills/pi-evo-research-create ~/.pi/agent/skills/
```

Then run `/reload` in pi.

---

## Usage

Start a session:

```text
/skill:pi-evo-research-create
```

Or:

```text
/evo-research optimize unit test runtime, keep correctness checks passing
```

The agent will ask or infer:

- objective
- benchmark command
- primary metric and direction
- secondary metrics
- files in scope
- constraints and off-limits areas

It writes session files, creates `evo-research.population.json`, runs a baseline, then loops:

```text
inspect → propose candidate → edit → run_experiment → log_experiment → keep/discard → update population → repeat
```

---

## Evolutionary mode

Evolutionary mode is a search policy for broad or noisy optimization tasks. It is not genetic programming and does not splice arbitrary code together.

### Candidate representation

Each experiment should correspond to a candidate hypothesis or patch family:

```json
{
  "candidate_id": "cand-cache-parser-v2",
  "family": "caching",
  "parent_id": "cand-cache-parser-v1",
  "operator": "mutation",
  "hypothesis": "Cache parser output by file content hash",
  "genome": {
    "strategy": "memoization",
    "scope": ["src/parser.ts"],
    "knobs": { "cache_key": "content_hash" }
  }
}
```

The agent logs this through `log_experiment({ asi: ... })`. The extension already persists ASI in `evo-research.jsonl`, so no new tool contract is required.

### Operators

| Operator | Use |
|---|---|
| `seed` | Introduce a new candidate family |
| `mutation` | Small variant of a promising candidate |
| `parameter_tune` | Adjust constants, thresholds, flags, or config |
| `specialization` | Add a narrower fast path |
| `simplification` | Preserve gain while reducing complexity |
| `recombination` | Combine independent kept ideas that touch compatible areas |
| `novelty` | Deliberately try a different family after stagnation |

### Selection rules

- Primary metric decides fitness.
- Checks must pass before a result can be kept.
- Confidence score guards against noisy wins.
- Simpler changes beat complex changes with similar fitness.
- Do not spend more than a few consecutive runs in one failing family.
- Keep diversity: retain at least one promising alternative family even while exploiting a winner.

### What to avoid

- Do not optimize sub-tasks in isolation unless global benchmark still improves.
- Do not combine patches just because both were individually good; recombine only when interactions are understood.
- Do not perform textual crossover over code.
- Do not keep benchmark-only tricks that violate real constraints.

---

## Session files

| File | Purpose |
|---|---|
| `evo-research.md` | Session plan and durable context for future agents |
| `evo-research.sh` | Executable benchmark script that emits `METRIC name=value` lines |
| `evo-research.checks.sh` | Optional executable correctness/type/lint backpressure checks |
| `evo-research.ideas.md` | Candidate backlog and deferred hypotheses |
| `evo-research.jsonl` | Append-only experiment log, metrics, ASI, confidence, status |
| `evo-research.population.json` | Optional persistent population state for broad or long evolutionary runs |
| `evo-research.hooks/` | Optional before/after scripts for session automation |

Generated shell scripts should be marked executable before the agent invokes them:

```bash
chmod +x evo-research.sh
# if present:
chmod +x evo-research.checks.sh
```

`run_experiment` also applies `chmod +x` to `evo-research.sh` and `evo-research.checks.sh` before invocation as a safety net.

`evo-research.population.json` is created and maintained by the extension. It is small, inspectable state for ranking candidates, tracking family failures, and triggering novelty after stagnation.

Minimal lifecycle:

1. `/evo-research` or `init_experiment` creates population state when needed.
2. `log_experiment` updates population state from the latest result and ASI.
3. Before the next iteration, evo-research prints a deterministic population steer message.
4. Benchmark results remain the source of truth; population state only guides which hypothesis to try next.

Core shape:

```json
{
  "schema_version": 1,
  "generation": 0,
  "active_candidate_id": null,
  "stagnation_runs": 0,
  "candidates": [],
  "families": [],
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

---

## ASI convention

Use `log_experiment` ASI to make evolutionary state durable:

```json
{
  "candidate_id": "cand-batch-io-v3",
  "generation": 4,
  "family": "batching",
  "parent_id": "cand-batch-io-v2",
  "operator": "mutation",
  "hypothesis": "Batch file reads before parsing",
  "genome": {
    "strategy": "batching",
    "knobs": { "batch_size": 32 }
  },
  "outcome_learning": "Reduced syscalls but increased memory pressure",
  "next_mutation": "Try smaller batch size and reuse buffer"
}
```

This lets a resumed agent continue the search without relying on chat history.

---

## Hooks

The extension handles population scheduling by default. Hooks remain available for custom automation or for users who want to replace/augment the default policy:

- `evo-research.hooks/after.sh`: run retrospective automation after a logged result.
- `evo-research.hooks/before.sh`: print additional steer messages before the next iteration.

Reference population hook examples still ship with the hooks skill as editable shell equivalents of the default policy. They require `jq` at runtime because hook payloads are JSON:

```bash
# Linux: install jq with your distro package manager, e.g. apt install jq
# macOS: brew install jq
mkdir -p evo-research.hooks
cp "<skill-dir>/examples/after/population-update.sh" evo-research.hooks/after.sh
cp "<skill-dir>/examples/before/population-scheduler.sh" evo-research.hooks/before.sh
chmod +x evo-research.hooks/after.sh evo-research.hooks/before.sh
```

Good hook behavior:

```text
Next: mutate cand-fast-path-v2 by reducing allocations in tokenizer.
Avoid: regex family; 4 failed checked runs.
Inject novelty if next run fails.
```

Hooks are optional. The core loop works without them.

---

## Dashboard and confidence

The dashboard shows run history, primary metric, secondary metrics, kept/discarded status, commits, and confidence.

Confidence is advisory. It estimates whether the best improvement is larger than observed noise. Low confidence should trigger confirmation reruns or candidate diversification, not automatic rejection.

---

## Example domains

| Domain | Primary metric | Candidate families |
|---|---|---|
| Test speed | seconds ↓ | parallelism, fixture caching, selective setup, config tuning |
| Parser/runtime | µs ↓ | fast paths, data structures, memoization, allocation reduction |
| Bundle size | KB ↓ | tree-shaking, dependency removal, build config, code splitting |
| ML training | validation loss ↓ | schedules, architecture knobs, data pipeline, regularization |
| Web perf | Lighthouse score ↑ | caching, payload reduction, hydration strategy, image handling |

---

## Acknowledgements

`pi-evo-research` is derived from David Cortés' [`pi-autoresearch`](https://github.com/davebcn87/pi-autoresearch), his pi adaptation of Andrej Karpathy's [`autoresearch`](https://github.com/karpathy/autoresearch) idea.

## Positioning

Short version:

> Population-guided evolutionary research for coding agents.

Longer version:

> Built on David Cortés' pi-autoresearch adaptation of Karpathy's autoresearch idea, `pi-evo-research` explores a population of hypotheses instead of hill-climbing one idea at a time.

---

## License

MIT
