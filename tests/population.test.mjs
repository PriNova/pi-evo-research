import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import test from "node:test";
import { tmpdir } from "node:os";

import {
  POPULATION_FILE_NAME,
  defaultPopulation,
  readPopulationFile,
  recommendNextCandidate,
  updatePopulationFromRun,
  writePopulationFile,
} from "../extensions/pi-evo-research/population.ts";

function run(overrides = {}) {
  return {
    run: 1,
    status: "keep",
    metric: 10,
    confidence: 2,
    timestamp: 123,
    description: "baseline candidate",
    asi: {
      candidate_id: "cand-cache-v1",
      family: "caching",
      operator: "seed",
      hypothesis: "cache parsed files",
      genome: { strategy: "memoization" },
    },
    ...overrides,
  };
}

test("default population has deterministic schema and scheduler defaults", () => {
  const population = defaultPopulation();

  assert.equal(POPULATION_FILE_NAME, "evo-research.population.json");
  assert.equal(population.schema_version, 1);
  assert.equal(population.generation, 0);
  assert.equal(population.active_candidate_id, null);
  assert.deepEqual(population.candidates, []);
  assert.deepEqual(population.families, []);
  assert.deepEqual(population.scheduler, {
    max_consecutive_family_failures: 3,
    novelty_after_stagnation_runs: 5,
    elite_limit: 3,
    max_consecutive_family_attempts: 2,
    explore_every_n_runs: 3,
    generation_size: 10,
    min_family_attempts_per_generation: 1,
  });
});

test("readPopulationFile bootstraps missing or malformed files", () => {
  const tempDir = fs.mkdtempSync(path.join(tmpdir(), "pi-evo-population-"));
  try {
    assert.deepEqual(readPopulationFile(path.join(tempDir, POPULATION_FILE_NAME)), defaultPopulation());

    const malformed = path.join(tempDir, "bad.json");
    fs.writeFileSync(malformed, "not json");
    assert.deepEqual(readPopulationFile(malformed), defaultPopulation());
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("writePopulationFile persists stable pretty JSON", () => {
  const tempDir = fs.mkdtempSync(path.join(tmpdir(), "pi-evo-population-"));
  const file = path.join(tempDir, POPULATION_FILE_NAME);
  try {
    writePopulationFile(file, defaultPopulation());
    const text = fs.readFileSync(file, "utf-8");
    assert.match(text, /^\{\n  "schema_version": 1,/);
    assert.equal(text.endsWith("\n"), true);
    assert.equal(readPopulationFile(file).schema_version, 1);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("updatePopulationFromRun creates candidate and family from ASI", () => {
  const population = updatePopulationFromRun(defaultPopulation(), run(), { direction: "lower" });

  assert.equal(population.active_candidate_id, "cand-cache-v1");
  assert.equal(population.candidates.length, 1);
  assert.deepEqual(population.candidates[0], {
    id: "cand-cache-v1",
    family: "caching",
    parent_id: null,
    operator: "seed",
    hypothesis: "cache parsed files",
    genome: { strategy: "memoization" },
    status: "elite",
    fitness_history: [
      {
        run: 1,
        status: "keep",
        metric: 10,
        direction: "lower",
        confidence: 2,
        timestamp: 123,
        description: "baseline candidate",
      },
    ],
    last_result_ref: 1,
    notes: [],
  });
  assert.deepEqual(population.families, [
    { name: "caching", attempts: 1, failures: 0, keeps: 1, retired: false, consecutive_failures: 0 },
  ]);
});

test("discard, crash, and checks_failed update family failures", () => {
  let population = defaultPopulation();
  population = updatePopulationFromRun(population, run({ run: 1, status: "discard", metric: 11 }), { direction: "lower" });
  population = updatePopulationFromRun(population, run({ run: 2, status: "crash", metric: 0 }), { direction: "lower" });
  population = updatePopulationFromRun(population, run({ run: 3, status: "checks_failed", metric: 9 }), { direction: "lower" });

  assert.equal(population.families[0].attempts, 3);
  assert.equal(population.families[0].failures, 3);
  assert.equal(population.families[0].consecutive_failures, 3);
  assert.equal(population.candidates[0].fitness_history.map((entry) => entry.status).join(","), "discard,crash,checks_failed");
});

test("family retires after max consecutive failures", () => {
  let population = defaultPopulation();
  population.scheduler.max_consecutive_family_failures = 2;

  population = updatePopulationFromRun(population, run({ run: 1, status: "discard", metric: 11 }), { direction: "lower" });
  population = updatePopulationFromRun(population, run({ run: 2, status: "checks_failed", metric: 12 }), { direction: "lower" });

  assert.equal(population.families[0].retired, true);
  assert.equal(population.candidates[0].status, "retired");
});

test("stagnation resets on meaningful kept improvement and increases otherwise", () => {
  let population = defaultPopulation();
  population = updatePopulationFromRun(population, run({ run: 1, metric: 10 }), { direction: "lower" });
  assert.equal(population.stagnation_runs, 0);

  population = updatePopulationFromRun(population, run({ run: 2, metric: 10.5, asi: { candidate_id: "cand-cache-v2", family: "caching" } }), { direction: "lower" });
  assert.equal(population.stagnation_runs, 1);

  population = updatePopulationFromRun(population, run({ run: 3, metric: 8, asi: { candidate_id: "cand-cache-v3", family: "caching" } }), { direction: "lower" });
  assert.equal(population.stagnation_runs, 0);
});

test("recommendNextCandidate mutates best non-retired elite", () => {
  let population = defaultPopulation();
  population = updatePopulationFromRun(population, run({ run: 1, metric: 10, asi: { candidate_id: "cand-a", family: "a" } }), { direction: "lower" });
  population = updatePopulationFromRun(population, run({ run: 2, metric: 7, asi: { candidate_id: "cand-b", family: "b" } }), { direction: "lower" });

  const recommendation = recommendNextCandidate(population, { direction: "lower" });

  assert.equal(recommendation.mode, "mutate");
  assert.equal(recommendation.candidate_id, "cand-b");
  assert.equal(recommendation.family, "b");
  assert.match(recommendation.message, /Mutate elite cand-b/);
});

test("recommendNextCandidate explores predeclared untried families before mutating elites", () => {
  let population = defaultPopulation();
  population = updatePopulationFromRun(population, run({ run: 1, metric: 10, asi: { candidate_id: "cand-a", family: "a" } }), { direction: "lower" });
  population.families.push({ name: "tree_shape", attempts: 0, failures: 0, keeps: 0, retired: false, consecutive_failures: 0 });

  const recommendation = recommendNextCandidate(population, { direction: "lower" });

  assert.equal(recommendation.mode, "seed");
  assert.equal(recommendation.candidate_id, null);
  assert.equal(recommendation.family, "tree_shape");
  assert.match(recommendation.message, /Explore untried family/);
});

test("recommendNextCandidate forces exploration after repeated attempts in one family", () => {
  let population = defaultPopulation();
  population = updatePopulationFromRun(population, run({ run: 1, metric: 10, asi: { candidate_id: "cand-a1", family: "a" } }), { direction: "lower" });
  population = updatePopulationFromRun(population, run({ run: 2, metric: 9, asi: { candidate_id: "cand-a2", family: "a" } }), { direction: "lower" });
  population = updatePopulationFromRun(population, run({ run: 3, metric: 8, asi: { candidate_id: "cand-b", family: "b" } }), { direction: "lower" });
  population = updatePopulationFromRun(population, run({ run: 4, metric: 7, asi: { candidate_id: "cand-a3", family: "a" } }), { direction: "lower" });
  population = updatePopulationFromRun(population, run({ run: 5, metric: 6, asi: { candidate_id: "cand-a4", family: "a" } }), { direction: "lower" });

  const recommendation = recommendNextCandidate(population, { direction: "lower" });

  assert.equal(recommendation.mode, "mutate");
  assert.equal(recommendation.family, "b");
  assert.equal(recommendation.candidate_id, "cand-b");
  assert.match(recommendation.message, /Explore another family/);
});

test("recommendNextCandidate uses deterministic exploration intervals", () => {
  let population = defaultPopulation();
  population.scheduler.max_consecutive_family_attempts = 10;
  population = updatePopulationFromRun(population, run({ run: 1, metric: 10, asi: { candidate_id: "cand-a", family: "a" } }), { direction: "lower" });
  population = updatePopulationFromRun(population, run({ run: 2, metric: 7, asi: { candidate_id: "cand-b", family: "b" } }), { direction: "lower" });
  population = updatePopulationFromRun(population, run({ run: 3, metric: 6, asi: { candidate_id: "cand-c", family: "a" } }), { direction: "lower" });

  const recommendation = recommendNextCandidate(population, { direction: "lower" });

  assert.equal(recommendation.mode, "mutate");
  assert.equal(recommendation.family, "b");
  assert.equal(recommendation.candidate_id, "cand-b");
  assert.match(recommendation.message, /Deterministic exploration interval/);
});

test("recommendNextCandidate injects novelty after stagnation threshold", () => {
  const population = defaultPopulation();
  population.stagnation_runs = 5;
  population.candidates.push({
    id: "cand-a",
    family: "a",
    parent_id: null,
    operator: "seed",
    hypothesis: "a",
    genome: null,
    status: "elite",
    fitness_history: [{ run: 1, status: "keep", metric: 10, direction: "lower", confidence: null, timestamp: null }],
    last_result_ref: 1,
    notes: [],
  });

  const recommendation = recommendNextCandidate(population, { direction: "lower" });

  assert.equal(recommendation.mode, "novelty");
  assert.equal(recommendation.candidate_id, null);
  assert.match(recommendation.message, /Inject novelty/);
});

test("recommendNextCandidate avoids retired families", () => {
  let population = defaultPopulation();
  population.scheduler.max_consecutive_family_failures = 1;
  population = updatePopulationFromRun(population, run({ run: 1, status: "discard", metric: 11, asi: { candidate_id: "cand-a", family: "a" } }), { direction: "lower" });
  population = updatePopulationFromRun(population, run({ run: 2, metric: 9, asi: { candidate_id: "cand-b", family: "b" } }), { direction: "lower" });

  const recommendation = recommendNextCandidate(population, { direction: "lower" });

  assert.equal(recommendation.mode, "mutate");
  assert.equal(recommendation.candidate_id, "cand-b");
  assert.deepEqual(recommendation.avoid, ["a"]);
});

test("missing candidate_id gets deterministic fallback and ASI reminder note", () => {
  const population = updatePopulationFromRun(defaultPopulation(), run({ asi: { family: "unknown", hypothesis: "try fallback" } }), { direction: "lower" });

  assert.equal(population.candidates[0].id, "cand-run-1");
  assert.equal(population.candidates[0].notes[0], "candidate_id missing in ASI; derived from run number");
});
