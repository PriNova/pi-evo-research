# Glossary

Evolutionary terms used by `pi-evo-research`. The project evolves hypotheses and patch strategies for coding agents, not raw code strings.

## Core loop

| Term | Meaning in `pi-evo-research` | Evolutionary-algorithm analogy |
|---|---|---|
| **Run** | One measured experiment: choose a candidate, apply/edit code, run the benchmark/checks, then log the result. A run is stored in `evo-research.jsonl` with status, metric, confidence, and optional ASI metadata. | One fitness evaluation. |
| **Iteration** | Same practical unit as a run: one candidate experiment from proposal through logging. | One evaluation step. |
| **Experiment** | The overall optimization session plus its individual measured trials. Context lives in files such as `evo-research.md`, `evo-research.sh`, `evo-research.jsonl`, and `evo-research.population.json`. | Search campaign. |
| **Session** | Durable working context for one optimization objective: metric direction, constraints, logs, population state, and notes. | Evolution run / optimization run. |
| **Baseline** | First reference measurement before candidate changes. Later candidates are compared against this and/or the best kept result. | Initial fitness reference. |
| **Benchmark** | Command that measures the target and emits `METRIC name=value` lines. Benchmark output is source of truth for fitness. | Fitness function. |
| **Checks** | Correctness, type, lint, or compatibility commands that must pass before a result can be kept. | Feasibility constraints. |

## Population and candidates

| Term | Meaning in `pi-evo-research` | Evolutionary-algorithm analogy |
|---|---|---|
| **Population** | Set of known candidates and families tracked in `evo-research.population.json`, including fitness history, statuses, and scheduler settings. | Population of individuals/lineages. |
| **Candidate** | A concrete hypothesis or patch strategy evaluated by one or more runs. Identified by `candidate_id`. | Individual. |
| **Candidate ID** | Stable identifier for a candidate, usually logged in ASI as `candidate_id` such as `cand-cache-v2`. If omitted, the extension derives one from the run number. | Individual identifier. |
| **Family** | Group of related candidates that share a strategy, mechanism, or search direction, such as `caching`, `batching`, or `allocation-reduction`. Families preserve diversity and prevent over-tunneling on one idea. | Species, niche, or lineage. |
| **Generation** | Coarse scheduling window used to balance attempts across families. In this project, a generation is not a synchronized genetic generation; it advances through logged ASI and `generation_size` windows. | Generation / epoch, adapted for asynchronous agent search. |
| **Elite** | Candidate with a kept result. Elites are preferred parents for mutation but are not automatically final answers. | Elite individual selected for exploitation. |
| **`active_candidate_id`** | Population field storing the most recently attempted candidate ID. | Current individual under evaluation. |
| **Retired family** | Family marked as no longer worth exploring, usually after too many consecutive failures. Its non-elite candidates are retired. | Extinct or pruned lineage. |
| **`failed`** | Candidate status used after a discard, crash, or checks failure when the candidate is not already retired. | Low-fitness or infeasible individual. |
| **Novelty candidate** | Candidate introduced specifically to escape stagnation or add diversity. | Novel individual from exploration/immigration. |

## Candidate metadata

| Term | Meaning in `pi-evo-research` | Evolutionary-algorithm analogy |
|---|---|---|
| **ASI** | Structured metadata passed to `log_experiment({ asi: ... })`: `candidate_id`, `generation`, `family`, `parent_id`, `operator`, `hypothesis`, `genome`, and learning notes. It makes evolutionary state resumable. | Genotype/lineage/evaluation annotations. |
| **Hypothesis** | Short claim about why a candidate should improve the metric, e.g. "Cache parser output by file content hash." | Phenotypic strategy description. |
| **Genome** | Structured description of the candidate strategy: knobs, scope, mechanism, and parameters. It describes what can be mutated without treating source code as DNA. | Genotype / parameter vector. |
| **Parent ID** | Candidate ID from which the current candidate was derived. | Parent pointer / ancestry. |
| **Operator** | How a candidate was produced: `seed`, `mutation`, `parameter_tune`, `specialization`, `simplification`, `recombination`, or `novelty`. | Variation operator. |
| **Outcome learning** | Note explaining what the run taught, even if it failed. | Evaluation feedback. |
| **Next mutation** | Suggested next variant based on the run outcome. | Proposed offspring variation. |

## Operators

| Operator | Meaning |
|---|---|
| **Seed** | Introduce a new family or first candidate in a search direction. |
| **Mutation** | Make a small change to a promising candidate. |
| **Parameter tune** | Adjust constants, thresholds, flags, config, or other knobs. |
| **Specialization** | Add a narrower fast path or targeted optimization for a specific case. |
| **Simplification** | Reduce complexity while preserving a gain. |
| **Recombination** | Combine independent kept ideas only when their interactions are understood. This is not textual crossover over code. |
| **Novelty** | Try a structurally different approach after stagnation or excessive local search. |

## Fitness and results

| Term | Meaning in `pi-evo-research` | Evolutionary-algorithm analogy |
|---|---|---|
| **Primary metric** | Main numeric target to optimize, such as `total_ms`, memory, bundle size, or score. | Fitness value. |
| **Direction** | Whether lower or higher primary metric values are better. | Fitness ordering. |
| **Fitness** | Interpreted quality of a run based on primary metric, direction, checks, and constraints. | Fitness. |
| **Secondary metrics** | Extra measured values used for tradeoffs and diagnostics, not the primary selection criterion. | Auxiliary objectives / traits. |
| **Confidence** | Advisory estimate that an improvement is larger than measurement noise. Low confidence suggests reruns or diversification. | Fitness certainty / statistical reliability. |
| **Keep** | Logged status for a candidate result that improved enough and passed checks. Kept changes may be committed. | Selection/survival. |
| **Discard** | Logged status for a candidate result that was worse, unchanged, or not worth keeping. Changes may be reverted. | Rejection. |
| **Crash** | Logged status for benchmark/build/runtime failure. | Infeasible evaluation. |
| **Checks failed** | Logged status for a run whose benchmark completed but correctness checks failed. | Constraint violation. |
| **Regressions** | Candidate outcomes worse than the baseline or current best, or outcomes that break required checks. | Fitness decreases / infeasible mutations. |

## Scheduling and search behavior

| Term | Meaning |
|---|---|
| **Selection** | Choosing which candidates or families deserve more runs, usually favoring elites while preserving diversity. |
| **Exploration** | Trying under-tested families or new strategies. |
| **Diversity** | Maintaining multiple plausible families so the search does not collapse into one local optimum. |
| **Stagnation** | Consecutive runs without meaningful improvement. Tracked as `stagnation_runs`. |
| **Inject novelty** | Scheduler action that asks for a new or structurally different family after too much stagnation. |
| **`consecutive_failures`** | Family field counting consecutive failed runs in one family. If it reaches `max_consecutive_family_failures`, the family can be retired. |
| **Generation size** | Scheduler setting defining the attempt-count window used for per-generation family balancing. |
| **`min_family_attempts_per_generation`** | Scheduler setting that gives each active family at least some exploration within a generation window. |
| **Explore every N runs** | Scheduler cadence that forces periodic exploration outside the current best line. |
| **Elite limit** | Maximum number of elite candidates considered for mutation recommendations. |
| **Local optimum** | A candidate/family that looks best nearby but blocks discovery of better, different strategies. Population search and novelty reduce this risk. |
| **Hill climbing** | Single-path search that repeatedly tweaks the current best. `pi-evo-research` avoids pure hill climbing by tracking families and diversity. |
| **Crossover** | Genetic algorithm operation that mixes genomes. `pi-evo-research` generally avoids raw code crossover; use cautious recombination of understood, independent ideas instead. |

## Files and state

| File | Role |
|---|---|
| `evo-research.md` | Session plan and durable context. |
| `evo-research.sh` | Benchmark script that emits `METRIC name=value`. |
| `evo-research.checks.sh` | Optional correctness/type/lint checks. |
| `evo-research.ideas.md` | Candidate backlog and deferred hypotheses. |
| `evo-research.jsonl` | Append-only run log with metrics, statuses, confidence, commits, and ASI. |
| `evo-research.population.json` | Persistent population state: candidates, families, generation, stagnation, scheduler settings. |
| `evo-research.hooks/` | Optional before/after automation hooks for custom steering. |
