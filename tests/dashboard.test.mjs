import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Script } from "node:vm";
import test from "node:test";

function extractDashboardScript(html) {
  const match = html.match(/<script>([\s\S]*?)<\/script>/);
  assert.ok(match, "dashboard template should contain an inline script");
  return match[1];
}

test("dashboard template inline script is valid JavaScript", () => {
  const html = readFileSync(new URL("../assets/template.html", import.meta.url), "utf8");
  assert.doesNotThrow(() => new Script(extractDashboardScript(html)));
});
