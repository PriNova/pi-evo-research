import * as fs from "node:fs";

export const POPULATION_FILE_NAME = "evo-research.population.json";

export type RunStatus = "keep" | "discard" | "crash" | "checks_failed";
export type Direction = "lower" | "higher";
export type CandidateStatus = "active" | "elite" | "retired" | "failed" | "novelty";

export interface FitnessHistoryEntry {
  run: number;
  status: RunStatus;
  metric: number | null;
  direction: Direction;
  confidence: number | null;
  timestamp: number | null;
  description?: string;
}

export interface Candidate {
  id: string;
  family: string;
  parent_id: string | null;
  operator: string;
  hypothesis: string;
  genome: unknown;
  status: CandidateStatus;
  fitness_history: FitnessHistoryEntry[];
  last_result_ref: number | null;
  notes: string[];
}

export interface Family {
  name: string;
  attempts: number;
  failures: number;
  keeps: number;
  retired: boolean;
  consecutive_failures: number;
}

export interface PopulationScheduler {
  max_consecutive_family_failures: number;
  novelty_after_stagnation_runs: number;
  elite_limit: number;
  max_consecutive_family_attempts: number;
  explore_every_n_runs: number;
  generation_size: number;
  min_family_attempts_per_generation: number;
}

export interface PopulationState {
  schema_version: 1;
  generation: number;
  active_candidate_id: string | null;
  stagnation_runs: number;
  candidates: Candidate[];
  families: Family[];
  scheduler: PopulationScheduler;
}

export interface SessionLike {
  direction?: Direction;
}

export interface RunEntryLike {
  run?: number;
  status?: RunStatus;
  metric?: number;
  confidence?: number | null;
  timestamp?: number;
  description?: string;
  asi?: Record<string, unknown>;
}

export type RecommendationMode = "seed" | "mutate" | "novelty";

export interface PopulationRecommendation {
  mode: RecommendationMode;
  candidate_id: string | null;
  family: string | null;
  message: string;
  avoid: string[];
}

const DEFAULT_SCHEDULER: PopulationScheduler = {
  max_consecutive_family_failures: 3,
  novelty_after_stagnation_runs: 5,
  elite_limit: 3,
  max_consecutive_family_attempts: 2,
  explore_every_n_runs: 3,
  generation_size: 10,
  min_family_attempts_per_generation: 1,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function stringFrom(value: unknown, fallback = ""): string {
  return typeof value === "string" && value.trim() ? value : fallback;
}

function numberFrom(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function directionFrom(value: unknown): Direction {
  return value === "higher" ? "higher" : "lower";
}

function statusFrom(value: unknown): RunStatus {
  if (value === "discard" || value === "crash" || value === "checks_failed") return value;
  return "keep";
}

function candidateStatusFrom(value: unknown): CandidateStatus {
  if (value === "elite" || value === "retired" || value === "failed" || value === "novelty") return value;
  return "active";
}

function candidateIdFrom(run: RunEntryLike): string {
  const fromAsi = stringFrom(run.asi?.candidate_id);
  if (fromAsi) return fromAsi;
  return `cand-run-${numberFrom(run.run, 0)}`;
}

function familyNameFrom(run: RunEntryLike): string {
  return stringFrom(run.asi?.family, "uncategorized");
}

function normalizeScheduler(value: unknown): PopulationScheduler {
  const scheduler = isRecord(value) ? value : {};
  return {
    max_consecutive_family_failures: Math.max(1, numberFrom(scheduler.max_consecutive_family_failures, DEFAULT_SCHEDULER.max_consecutive_family_failures)),
    novelty_after_stagnation_runs: Math.max(1, numberFrom(scheduler.novelty_after_stagnation_runs, DEFAULT_SCHEDULER.novelty_after_stagnation_runs)),
    elite_limit: Math.max(1, numberFrom(scheduler.elite_limit, DEFAULT_SCHEDULER.elite_limit)),
    max_consecutive_family_attempts: Math.max(1, numberFrom(scheduler.max_consecutive_family_attempts, DEFAULT_SCHEDULER.max_consecutive_family_attempts)),
    explore_every_n_runs: Math.max(1, numberFrom(scheduler.explore_every_n_runs, DEFAULT_SCHEDULER.explore_every_n_runs)),
    generation_size: Math.max(1, numberFrom(scheduler.generation_size, DEFAULT_SCHEDULER.generation_size)),
    min_family_attempts_per_generation: Math.max(0, numberFrom(scheduler.min_family_attempts_per_generation, DEFAULT_SCHEDULER.min_family_attempts_per_generation)),
  };
}

function normalizeCandidate(value: unknown): Candidate | null {
  if (!isRecord(value)) return null;
  const id = stringFrom(value.id);
  if (!id) return null;
  return {
    id,
    family: stringFrom(value.family, "uncategorized"),
    parent_id: stringFrom(value.parent_id) || null,
    operator: stringFrom(value.operator, "seed"),
    hypothesis: stringFrom(value.hypothesis),
    genome: value.genome ?? null,
    status: candidateStatusFrom(value.status),
    fitness_history: Array.isArray(value.fitness_history) ? value.fitness_history.filter(isRecord).map((entry) => ({
      run: numberFrom(entry.run, 0),
      status: statusFrom(entry.status),
      metric: typeof entry.metric === "number" ? entry.metric : null,
      direction: directionFrom(entry.direction),
      confidence: typeof entry.confidence === "number" ? entry.confidence : null,
      timestamp: typeof entry.timestamp === "number" ? entry.timestamp : null,
      description: typeof entry.description === "string" ? entry.description : undefined,
    })) : [],
    last_result_ref: typeof value.last_result_ref === "number" ? value.last_result_ref : null,
    notes: Array.isArray(value.notes) ? value.notes.filter((note): note is string => typeof note === "string") : [],
  };
}

function normalizeFamily(value: unknown): Family | null {
  if (!isRecord(value)) return null;
  const name = stringFrom(value.name);
  if (!name) return null;
  return {
    name,
    attempts: Math.max(0, numberFrom(value.attempts, 0)),
    failures: Math.max(0, numberFrom(value.failures, 0)),
    keeps: Math.max(0, numberFrom(value.keeps, 0)),
    retired: value.retired === true,
    consecutive_failures: Math.max(0, numberFrom(value.consecutive_failures, 0)),
  };
}

export function defaultPopulation(): PopulationState {
  return {
    schema_version: 1,
    generation: 0,
    active_candidate_id: null,
    stagnation_runs: 0,
    candidates: [],
    families: [],
    scheduler: { ...DEFAULT_SCHEDULER },
  };
}

export function normalizePopulation(value: unknown): PopulationState {
  if (!isRecord(value)) return defaultPopulation();
  const population = defaultPopulation();
  population.generation = Math.max(0, numberFrom(value.generation, 0));
  population.active_candidate_id = stringFrom(value.active_candidate_id) || null;
  population.stagnation_runs = Math.max(0, numberFrom(value.stagnation_runs, 0));
  population.candidates = Array.isArray(value.candidates) ? value.candidates.map(normalizeCandidate).filter((candidate): candidate is Candidate => candidate !== null) : [];
  population.families = Array.isArray(value.families) ? value.families.map(normalizeFamily).filter((family): family is Family => family !== null) : [];
  population.scheduler = normalizeScheduler(value.scheduler);
  return population;
}

export function readPopulationFile(filePath: string): PopulationState {
  if (!fs.existsSync(filePath)) return defaultPopulation();
  try {
    return normalizePopulation(JSON.parse(fs.readFileSync(filePath, "utf-8")));
  } catch {
    return defaultPopulation();
  }
}

export function writePopulationFile(filePath: string, population: PopulationState): void {
  fs.writeFileSync(filePath, `${JSON.stringify(normalizePopulation(population), null, 2)}\n`);
}

function getOrCreateFamily(population: PopulationState, name: string): Family {
  const existing = population.families.find((family) => family.name === name);
  if (existing) return existing;
  const created: Family = { name, attempts: 0, failures: 0, keeps: 0, retired: false, consecutive_failures: 0 };
  population.families.push(created);
  return created;
}

function getOrCreateCandidate(population: PopulationState, run: RunEntryLike): Candidate {
  const id = candidateIdFrom(run);
  const existing = population.candidates.find((candidate) => candidate.id === id);
  if (existing) return existing;
  const asi = run.asi ?? {};
  const candidate: Candidate = {
    id,
    family: familyNameFrom(run),
    parent_id: stringFrom(asi.parent_id) || null,
    operator: stringFrom(asi.operator, "seed"),
    hypothesis: stringFrom(asi.hypothesis, stringFrom(run.description)),
    genome: asi.genome ?? null,
    status: stringFrom(asi.operator) === "novelty" ? "novelty" : "active",
    fitness_history: [],
    last_result_ref: null,
    notes: [],
  };
  if (!run.asi?.candidate_id) candidate.notes.push("candidate_id missing in ASI; derived from run number");
  population.candidates.push(candidate);
  return candidate;
}

function bestKeptMetric(population: PopulationState): number | null {
  let best: number | null = null;
  let direction: Direction = "lower";
  for (const candidate of population.candidates) {
    for (const entry of candidate.fitness_history) {
      if (entry.status !== "keep" || entry.metric === null) continue;
      direction = entry.direction;
      if (best === null || isBetter(entry.metric, best, direction)) best = entry.metric;
    }
  }
  return best;
}

function isBetter(metric: number, best: number, direction: Direction): boolean {
  return direction === "higher" ? metric > best : metric < best;
}

function retireFamilyCandidates(population: PopulationState, familyName: string): void {
  for (const candidate of population.candidates) {
    if (candidate.family === familyName && candidate.status !== "elite") candidate.status = "retired";
  }
}

export function updatePopulationFromRun(
  inputPopulation: PopulationState,
  run: RunEntryLike,
  session: SessionLike = {},
): PopulationState {
  const population = normalizePopulation(inputPopulation);
  const direction = directionFrom(session.direction);
  const status = statusFrom(run.status);
  const metric = typeof run.metric === "number" ? run.metric : null;
  const previousBest = bestKeptMetric(population);
  const candidate = getOrCreateCandidate(population, run);
  const family = getOrCreateFamily(population, candidate.family);

  const entry: FitnessHistoryEntry = {
    run: numberFrom(run.run, candidate.fitness_history.length + 1),
    status,
    metric,
    direction,
    confidence: typeof run.confidence === "number" ? run.confidence : null,
    timestamp: typeof run.timestamp === "number" ? run.timestamp : null,
    description: typeof run.description === "string" ? run.description : undefined,
  };

  candidate.fitness_history.push(entry);
  candidate.last_result_ref = entry.run;
  population.active_candidate_id = candidate.id;
  population.generation = Math.max(population.generation, Math.floor(numberFrom(run.asi?.generation, population.generation)));

  family.attempts += 1;
  if (status === "keep") {
    family.keeps += 1;
    family.consecutive_failures = 0;
    candidate.status = "elite";
    const improved = metric !== null && (previousBest === null || isBetter(metric, previousBest, direction));
    population.stagnation_runs = improved ? 0 : population.stagnation_runs + 1;
  } else {
    family.failures += 1;
    family.consecutive_failures += 1;
    if (candidate.status !== "retired") candidate.status = "failed";
    population.stagnation_runs += 1;
  }

  if (family.consecutive_failures >= population.scheduler.max_consecutive_family_failures) {
    family.retired = true;
    retireFamilyCandidates(population, family.name);
  }

  return population;
}

function familyFor(population: PopulationState, name: string): Family | undefined {
  return population.families.find((family) => family.name === name);
}

function retiredFamilyNames(population: PopulationState): string[] {
  return population.families.filter((family) => family.retired).map((family) => family.name).sort();
}

function candidateBestMetric(candidate: Candidate, direction: Direction): number | null {
  let best: number | null = null;
  for (const entry of candidate.fitness_history) {
    if (entry.status !== "keep" || entry.metric === null) continue;
    if (best === null || isBetter(entry.metric, best, direction)) best = entry.metric;
  }
  return best;
}

function activeFamilies(population: PopulationState): Family[] {
  return population.families.filter((family) => !family.retired).sort((a, b) => a.attempts - b.attempts || a.failures - b.failures || a.name.localeCompare(b.name));
}

function totalFamilyAttempts(population: PopulationState): number {
  return population.families.reduce((total, family) => total + family.attempts, 0);
}

function familyAttemptHistory(population: PopulationState): Array<{ run: number; family: string }> {
  const history: Array<{ run: number; family: string }> = [];
  for (const candidate of population.candidates) {
    for (const entry of candidate.fitness_history) {
      history.push({ run: entry.run, family: candidate.family });
    }
  }
  return history.sort((a, b) => a.run - b.run);
}

function lastFamilyAttemptStreak(population: PopulationState): { family: string | null; count: number } {
  const history = familyAttemptHistory(population);
  const last = history.at(-1)?.family ?? null;
  if (!last) return { family: null, count: 0 };
  let count = 0;
  for (let i = history.length - 1; i >= 0 && history[i].family === last; i--) count += 1;
  return { family: last, count };
}

function familyAttemptsThisGeneration(population: PopulationState, familyName: string): number {
  const size = population.scheduler.generation_size;
  const total = totalFamilyAttempts(population);
  const generationStartRun = Math.floor(total / size) * size + 1;
  return familyAttemptHistory(population).filter((entry) => entry.run >= generationStartRun && entry.family === familyName).length;
}

function candidateForFamily(population: PopulationState, familyName: string, direction: Direction): Candidate | null {
  const candidates = population.candidates
    .filter((candidate) => candidate.family === familyName && candidate.status === "elite")
    .map((candidate, index) => ({ candidate, index, bestMetric: candidateBestMetric(candidate, direction) }))
    .filter((item): item is { candidate: Candidate; index: number; bestMetric: number } => item.bestMetric !== null)
    .sort((a, b) => {
      if (a.bestMetric !== b.bestMetric) return direction === "higher" ? b.bestMetric - a.bestMetric : a.bestMetric - b.bestMetric;
      return b.candidate.last_result_ref! - a.candidate.last_result_ref! || a.index - b.index;
    });
  return candidates[0]?.candidate ?? null;
}

function exploreFamilyRecommendation(population: PopulationState, family: Family, direction: Direction, reason: string, avoid: string[]): PopulationRecommendation {
  const candidate = candidateForFamily(population, family.name, direction);
  if (candidate) {
    return {
      mode: "mutate",
      candidate_id: candidate.id,
      family: family.name,
      message: `${reason}; explore family ${family.name} by mutating its elite ${candidate.id}. Do not tunnel on the current global best unless evidence requires it.`,
      avoid,
    };
  }
  return {
    mode: "seed",
    candidate_id: null,
    family: family.name,
    message: `${reason}; seed a candidate in under-explored family ${family.name}. Log ASI with family=${family.name}.`,
    avoid,
  };
}

export function recommendNextCandidate(
  inputPopulation: PopulationState,
  session: SessionLike = {},
): PopulationRecommendation {
  const population = normalizePopulation(inputPopulation);
  const direction = directionFrom(session.direction);
  const avoid = retiredFamilyNames(population);

  if (population.candidates.length === 0) {
    return {
      mode: "seed",
      candidate_id: null,
      family: null,
      message: "Seed diverse candidate families and log ASI: candidate_id, family, operator, hypothesis, genome.",
      avoid,
    };
  }

  const untriedFamily = activeFamilies(population).find((family) => family.attempts === 0);
  if (untriedFamily) {
    return exploreFamilyRecommendation(population, untriedFamily, direction, "Explore untried family before mutating elites", avoid);
  }

  if (population.stagnation_runs >= population.scheduler.novelty_after_stagnation_runs) {
    return {
      mode: "novelty",
      candidate_id: null,
      family: null,
      message: `Inject novelty; ${population.stagnation_runs} stagnant runs reached threshold ${population.scheduler.novelty_after_stagnation_runs}.`,
      avoid,
    };
  }

  const active = activeFamilies(population);
  const lastStreak = lastFamilyAttemptStreak(population);
  const forcedDifferentFamily = lastStreak.family && lastStreak.count >= population.scheduler.max_consecutive_family_attempts
    ? active.find((family) => family.name !== lastStreak.family)
    : undefined;
  if (forcedDifferentFamily) {
    return exploreFamilyRecommendation(population, forcedDifferentFamily, direction, `Explore another family; ${lastStreak.family} reached ${lastStreak.count} consecutive attempts`, avoid);
  }

  const generationUnderQuota = active.find((family) => familyAttemptsThisGeneration(population, family.name) < population.scheduler.min_family_attempts_per_generation);
  if (generationUnderQuota) {
    return exploreFamilyRecommendation(population, generationUnderQuota, direction, `Balance generation ${population.generation}; family ${generationUnderQuota.name} is below its minimum attempt quota`, avoid);
  }

  const totalAttempts = totalFamilyAttempts(population);
  const intervalFamily = totalAttempts > 0 && totalAttempts % population.scheduler.explore_every_n_runs === 0
    ? active.find((family) => family.name !== lastStreak.family) ?? active[0]
    : undefined;
  if (intervalFamily) {
    return exploreFamilyRecommendation(population, intervalFamily, direction, `Deterministic exploration interval ${population.scheduler.explore_every_n_runs} reached at attempt ${totalAttempts}`, avoid);
  }

  const elites = population.candidates
    .filter((candidate) => candidate.status === "elite" && familyFor(population, candidate.family)?.retired !== true)
    .map((candidate, index) => ({ candidate, index, bestMetric: candidateBestMetric(candidate, direction) }))
    .filter((item): item is { candidate: Candidate; index: number; bestMetric: number } => item.bestMetric !== null)
    .sort((a, b) => {
      if (a.bestMetric !== b.bestMetric) return direction === "higher" ? b.bestMetric - a.bestMetric : a.bestMetric - b.bestMetric;
      return b.candidate.last_result_ref! - a.candidate.last_result_ref! || a.index - b.index;
    })
    .slice(0, population.scheduler.elite_limit);

  if (elites.length > 0) {
    const elite = elites[0].candidate;
    return {
      mode: "mutate",
      candidate_id: elite.id,
      family: elite.family,
      message: `Mutate elite ${elite.id} in family ${elite.family}; keep benchmark as source of truth.`,
      avoid,
    };
  }

  return {
    mode: "seed",
    candidate_id: null,
    family: null,
    message: "No non-retired elite exists; seed a structurally different candidate family.",
    avoid,
  };
}
