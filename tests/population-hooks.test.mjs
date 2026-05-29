import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { tmpdir } from "node:os";

const hasJq = spawnSync("jq", ["--version"], { encoding: "utf8" }).status === 0;
const afterHook = path.resolve("skills/pi-evo-research-hooks/examples/after/population-update.sh");
const beforeHook = path.resolve("skills/pi-evo-research-hooks/examples/before/population-scheduler.sh");

function session(overrides = {}) {
  return {
    metric_name: "total_ms",
    metric_unit: "ms",
    direction: "lower",
    baseline_metric: 10,
    best_metric: 10,
    run_count: 1,
    goal: "test population hooks",
    ...overrides,
  };
}

function runEntry(overrides = {}) {
  return {
    run: 1,
    status: "keep",
    metric: 10,
    confidence: null,
    description: "baseline candidate",
    timestamp: 1,
    asi: {
      candidate_id: "cand-baseline-1",
      family: "baseline",
      operator: "seed",
      hypothesis: "baseline implementation",
    },
    ...overrides,
  };
}

function runHook(script, payload) {
  return spawnSync("bash", [script], {
    input: JSON.stringify(payload),
    encoding: "utf8",
    timeout: 10_000,
  });
}

function readPopulation(workDir) {
  return JSON.parse(fs.readFileSync(path.join(workDir, "evo-research.population.json"), "utf8"));
}

test("population hooks create state and recommend mutating an elite", { skip: !hasJq && "jq is required for hook examples" }, () => {
  const workDir = fs.mkdtempSync(path.join(tmpdir(), "pi-evo-pop-hooks-"));
  try {
    const after = runHook(afterHook, {
      event: "after",
      cwd: workDir,
      run_entry: runEntry(),
      session: session(),
    });

    assert.equal(after.status, 0, after.stderr || after.stdout);
    assert.equal(after.stdout, "");

    const population = readPopulation(workDir);
    assert.equal(population.active_candidate_id, "cand-baseline-1");
    assert.equal(population.candidates[0].status, "elite");
    assert.equal(population.families[0].keeps, 1);

    const before = runHook(beforeHook, {
      event: "before",
      cwd: workDir,
      next_run: 2,
      last_run: null,
      session: session(),
    });

    assert.equal(before.status, 0, before.stderr || before.stdout);
    assert.match(before.stdout, /Next: mutate cand-baseline-1 in family baseline/);
    assert.doesNotMatch(before.stdout, /autoresearch/);
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
  }
});

test("population update hook reports missing candidate_id fallback", { skip: !hasJq && "jq is required for hook examples" }, () => {
  const workDir = fs.mkdtempSync(path.join(tmpdir(), "pi-evo-pop-hooks-"));
  try {
    const after = runHook(afterHook, {
      event: "after",
      cwd: workDir,
      run_entry: runEntry({
        run: 4,
        asi: { family: "fallback", operator: "seed", hypothesis: "missing id" },
      }),
      session: session(),
    });

    assert.equal(after.status, 0, after.stderr || after.stdout);
    assert.match(after.stdout, /candidate_id missing; used cand-run-4/);

    const population = readPopulation(workDir);
    assert.equal(population.candidates[0].id, "cand-run-4");
    assert.deepEqual(population.candidates[0].notes, ["candidate_id missing in ASI; derived from run number"]);
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
  }
});

test("population hooks recover from malformed population JSON", { skip: !hasJq && "jq is required for hook examples" }, () => {
  const workDir = fs.mkdtempSync(path.join(tmpdir(), "pi-evo-pop-hooks-"));
  try {
    fs.writeFileSync(path.join(workDir, "evo-research.population.json"), "not json");

    const before = runHook(beforeHook, {
      event: "before",
      cwd: workDir,
      next_run: 2,
      last_run: null,
      session: session(),
    });
    assert.equal(before.status, 0, before.stderr || before.stdout);
    assert.match(before.stdout, /invalid JSON/);

    const after = runHook(afterHook, {
      event: "after",
      cwd: workDir,
      run_entry: runEntry(),
      session: session(),
    });
    assert.equal(after.status, 0, after.stderr || after.stdout);
    assert.equal(fs.existsSync(path.join(workDir, "evo-research.population.json.invalid")), true);
    assert.equal(readPopulation(workDir).active_candidate_id, "cand-baseline-1");
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
  }
});

test("population hooks retire repeated-failure families and scheduler avoids them", { skip: !hasJq && "jq is required for hook examples" }, () => {
  const workDir = fs.mkdtempSync(path.join(tmpdir(), "pi-evo-pop-hooks-"));
  try {
    for (let run = 1; run <= 3; run++) {
      const after = runHook(afterHook, {
        event: "after",
        cwd: workDir,
        run_entry: runEntry({
          run,
          status: "discard",
          metric: 11 + run,
          asi: {
            candidate_id: `cand-doomed-${run}`,
            family: "doomed",
            operator: run === 1 ? "seed" : "mutation",
            hypothesis: "doomed family",
          },
        }),
        session: session({ run_count: run }),
      });
      assert.equal(after.status, 0, after.stderr || after.stdout);
      if (run === 3) assert.match(after.stdout, /retired family doomed/);
    }

    let population = readPopulation(workDir);
    assert.equal(population.families[0].retired, true);
    assert.deepEqual(population.candidates.map((candidate) => candidate.status), ["retired", "retired", "retired"]);

    const seedElite = runHook(afterHook, {
      event: "after",
      cwd: workDir,
      run_entry: runEntry({
        run: 4,
        metric: 9,
        asi: { candidate_id: "cand-good-1", family: "good", operator: "seed", hypothesis: "good family" },
      }),
      session: session({ best_metric: 9, run_count: 4 }),
    });
    assert.equal(seedElite.status, 0, seedElite.stderr || seedElite.stdout);

    const before = runHook(beforeHook, {
      event: "before",
      cwd: workDir,
      next_run: 5,
      last_run: null,
      session: session({ best_metric: 9, run_count: 4 }),
    });

    assert.equal(before.status, 0, before.stderr || before.stdout);
    assert.match(before.stdout, /Next: mutate cand-good-1 in family good/);
    assert.match(before.stdout, /Avoid: doomed/);
    assert.doesNotMatch(before.stdout, /autoresearch/);

    population = readPopulation(workDir);
    assert.equal(population.families.find((family) => family.name === "good").retired, false);
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
  }
});
