<div align="center">
<img height="120" alt="result" src="https://github.com/user-attachments/assets/c66cbd02-4491-4833-a63a-142cfd7530c1" />

# pi-evo-research
### Population-guided evolutionary research for coding agents

**[Install](#install)** · **[Usage](#usage)** · **[Evolutionary mode](#evolutionary-mode)**

</div>

`pi-evo-research` helps a coding agent optimize software by running measured experiments, keeping improvements, discarding regressions, and maintaining a diverse population of candidate hypotheses.

It builds on `pi-evo-research` by David Cortés ([@davebcn87](https://github.com/davebcn87)) and the evo-research pattern popularized by [karpathy/evo-research](https://github.com/karpathy/evo-research), but adds a more explicit search policy: avoid pure hill-climbing, track candidate families, mutate promising ideas, retire dead ends, and inject novelty when progress stalls.

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

It writes session files, runs a baseline, then loops:

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
| `evo-research.sh` | Benchmark script that emits `METRIC name=value` lines |
| `evo-research.checks.sh` | Optional correctness/type/lint backpressure checks |
| `evo-research.ideas.md` | Candidate backlog and deferred hypotheses |
| `evo-research.jsonl` | Append-only experiment log, metrics, ASI, confidence, status |
| `evo-research.hooks/` | Optional before/after scripts for session automation |

Optional future population state:

```text
evo-research.population.json
```

Use this only when a long run needs explicit candidate ranking beyond `evo-research.ideas.md` and JSONL history.

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
  "outcome_learning": "Reduced syscalls but increased memory pressure",
  "next_mutation": "Try smaller batch size and reuse buffer"
}
```

This lets a resumed agent continue the search without relying on chat history.

---

## Hooks

Hooks can act as a lightweight evolutionary scheduler without changing the extension:

- `evo-research.hooks/after.sh`: read latest JSONL entry, update rankings, retire weak families.
- `evo-research.hooks/before.sh`: print the next candidate suggestion as a steer message.

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

`pi-evo-research` is derived from David Cortés' original pi extension work ([@davebcn87](https://github.com/davebcn87)) and inspired by Andrej Karpathy's autonomous research loop idea.

## Positioning

Short version:

> Population-guided evolutionary research for coding agents.

Longer version:

> Built on David Cortés' pi-evo-research work and inspired by Karpathy's evo-research idea, `pi-evo-research` explores a population of hypotheses instead of hill-climbing one idea at a time.

---

## License

MIT
