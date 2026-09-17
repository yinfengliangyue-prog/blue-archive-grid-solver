const test = require("node:test");
const assert = require("node:assert/strict");
const Solver = require("./solver.js");

test("single domino on a 1x3 board has the expected heatmap", () => {
  const result = Solver.solve({
    rows: 1, cols: 3, forbiddenMask: 0n,
    shapes: [{ id: "d", w: 2, h: 1, count: 1, rotate: false }],
  });
  assert.equal(result.layoutMode, "exact");
  assert.deepEqual(result.probability, [0.5, 1, 0.5]);
  assert.deepEqual(result.bestCells, [1]);
  assert.equal(result.expectedRemainingFlips, 1);
});

test("a revealed miss removes every placement that crosses it", () => {
  const result = Solver.solve({
    rows: 1, cols: 3, forbiddenMask: Solver.bit(0),
    shapes: [{ id: "d", w: 2, h: 1, count: 1, rotate: false }],
  });
  assert.deepEqual(result.probability, [0, 1, 1]);
  assert.deepEqual(result.bestCells, [1, 2]);
});

test("identical objects are enumerated as combinations rather than permutations", () => {
  const enumeration = Solver.enumerateLayouts(
    1, 3, [{ id: "dot", w: 1, h: 1, count: 2, rotate: false }], 0n, 100,
  );
  assert.equal(enumeration.exact, true);
  assert.equal(enumeration.layouts.length, 3);
});

test("exact planner accounts for both hit and miss branches", () => {
  const result = Solver.solve({
    rows: 1, cols: 3, forbiddenMask: 0n,
    shapes: [{ id: "dot", w: 1, h: 1, count: 2, rotate: false }],
  });
  assert.equal(result.plannerMode, "exact");
  assert.ok(Math.abs(result.expectedRemainingFlips - 8 / 3) < 1e-9);
  assert.deepEqual(result.bestCells, [0, 1, 2]);
});

test("contradictory evidence is reported instead of producing fake probabilities", () => {
  const result = Solver.solve({
    rows: 1, cols: 2, forbiddenMask: Solver.bit(0) | Solver.bit(1),
    shapes: [{ id: "dot", w: 1, h: 1, count: 1, rotate: false }],
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "NO_LAYOUTS");
});

