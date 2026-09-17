(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.GridStrategySolver = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const bit = (index) => 1n << BigInt(index);
  const hasBit = (mask, index) => (mask & bit(index)) !== 0n;
  const layoutKey = (placements) => placements.map((p) => p.key).sort().join("|");

  function normalizeShapes(shapes) {
    return shapes
      .map((shape, index) => ({
        id: String(shape.id ?? `shape-${index}`),
        name: String(shape.name ?? `${shape.w}×${shape.h}`),
        w: Math.max(1, Math.floor(Number(shape.w) || 1)),
        h: Math.max(1, Math.floor(Number(shape.h) || 1)),
        count: Math.max(0, Math.floor(Number(shape.count) || 0)),
        rotate: shape.rotate !== false,
      }))
      .filter((shape) => shape.count > 0);
  }

  function generatePlacements(rows, cols, shape, forbiddenMask = 0n) {
    const orientations = [[shape.w, shape.h]];
    if (shape.rotate && shape.w !== shape.h) orientations.push([shape.h, shape.w]);
    const placements = [];

    for (const [w, h] of orientations) {
      if (w > cols || h > rows) continue;
      for (let row = 0; row <= rows - h; row += 1) {
        for (let col = 0; col <= cols - w; col += 1) {
          let mask = 0n;
          const cells = [];
          for (let dr = 0; dr < h; dr += 1) {
            for (let dc = 0; dc < w; dc += 1) {
              const cell = (row + dr) * cols + col + dc;
              cells.push(cell);
              mask |= bit(cell);
            }
          }
          if ((mask & forbiddenMask) !== 0n) continue;
          placements.push({
            typeId: shape.id,
            name: shape.name,
            w,
            h,
            row,
            col,
            cells,
            mask,
            size: cells.length,
            key: `${shape.id}:${row},${col},${w},${h}`,
          });
        }
      }
    }
    return placements;
  }

  function buildPlacementGroups(rows, cols, shapes, forbiddenMask = 0n) {
    return normalizeShapes(shapes).map((shape) => ({
      shape,
      placements: generatePlacements(rows, cols, shape, forbiddenMask),
    }));
  }

  function enumerateLayouts(rows, cols, shapes, forbiddenMask = 0n, limit = 20000, requiredMask = 0n) {
    requiredMask = BigInt(requiredMask);
    const groups = buildPlacementGroups(rows, cols, shapes, forbiddenMask);
    if (groups.some((group) => group.placements.length < group.shape.count)) {
      return { layouts: [], exact: true, truncated: false, groups };
    }

    // Put the most constrained object type first; this makes contradictions fast.
    const ordered = groups.slice().sort((a, b) => {
      const ar = a.placements.length / a.shape.count;
      const br = b.placements.length / b.shape.count;
      return ar - br;
    });
    const layouts = [];
    let truncated = false;

    function chooseWithin(groupIndex, start, left, occupied, selected) {
      if (truncated) return;
      const group = ordered[groupIndex];
      if (left === 0) {
        visitGroup(groupIndex + 1, occupied, selected);
        return;
      }
      const availableSlots = group.placements.length - start;
      if (availableSlots < left) return;

      for (let i = start; i < group.placements.length; i += 1) {
        const placement = group.placements[i];
        if ((placement.mask & occupied) !== 0n) continue;
        selected.push(placement);
        chooseWithin(groupIndex, i + 1, left - 1, occupied | placement.mask, selected);
        selected.pop();
        if (truncated) return;
      }
    }

    function visitGroup(groupIndex, occupied, selected) {
      if (truncated) return;
      if (groupIndex === ordered.length) {
        if ((occupied & requiredMask) !== requiredMask) return;
        if (layouts.length >= limit) {
          truncated = true;
          return;
        }
        layouts.push(selected.slice().sort((a, b) => a.key.localeCompare(b.key)));
        return;
      }
      chooseWithin(groupIndex, 0, ordered[groupIndex].shape.count, occupied, selected);
    }

    visitGroup(0, forbiddenMask, []);
    return { layouts, exact: !truncated, truncated, groups };
  }

  function sampleLayouts(rows, cols, shapes, forbiddenMask = 0n, options = {}) {
    const groups = buildPlacementGroups(rows, cols, shapes, forbiddenMask);
    const target = options.target ?? 4000;
    const maxAttempts = options.maxAttempts ?? Math.max(50000, target * 80);
    const random = options.random ?? Math.random;
    const requiredMask = BigInt(options.requiredMask ?? 0n);
    if (groups.some((group) => group.placements.length < group.shape.count)) {
      return { layouts: [], attempts: 0, accepted: 0, groups };
    }

    const instances = [];
    for (const group of groups) {
      for (let i = 0; i < group.shape.count; i += 1) instances.push(group);
    }
    // Constrained instances first improves rejection speed without changing the proposal.
    instances.sort((a, b) => a.placements.length - b.placements.length);

    const layouts = [];
    let attempts = 0;
    while (layouts.length < target && attempts < maxAttempts) {
      attempts += 1;
      let occupied = forbiddenMask;
      const chosen = [];
      let valid = true;
      for (const group of instances) {
        const placement = group.placements[Math.floor(random() * group.placements.length)];
        if (!placement || (placement.mask & occupied) !== 0n) {
          valid = false;
          break;
        }
        occupied |= placement.mask;
        chosen.push(placement);
      }
      if (valid && (occupied & requiredMask) === requiredMask) layouts.push(chosen.slice().sort((a, b) => a.key.localeCompare(b.key)));
    }
    return { layouts, attempts, accepted: layouts.length, groups };
  }

  function compressLayouts(layouts) {
    const map = new Map();
    for (const placements of layouts) {
      const key = layoutKey(placements);
      const prior = map.get(key);
      if (prior) prior.weight += 1;
      else map.set(key, { key, placements, weight: 1 });
    }
    return Array.from(map.values()).sort((a, b) => a.key.localeCompare(b.key));
  }

  function stateWeight(state) {
    return state.hypotheses.reduce((sum, hypothesis) => sum + hypothesis.weight, 0);
  }

  function remainingObjects(state) {
    if (!state.hypotheses.length) return 0;
    return state.hypotheses[0].placements.length;
  }

  function candidateMetrics(state, cellCount) {
    const total = stateWeight(state);
    const hitWeight = Array(cellCount).fill(0);
    const revealWeight = Array(cellCount).fill(0);
    if (!total) return { probability: hitWeight, expectedReveal: revealWeight };

    for (const hypothesis of state.hypotheses) {
      for (const placement of hypothesis.placements) {
        for (const cell of placement.cells) {
          hitWeight[cell] += hypothesis.weight;
          revealWeight[cell] += hypothesis.weight * placement.size;
        }
      }
    }
    return {
      probability: hitWeight.map((value) => value / total),
      expectedReveal: revealWeight.map((value) => value / total),
    };
  }

  function branchState(state, cell) {
    const byOutcome = new Map();
    for (const hypothesis of state.hypotheses) {
      const hit = hypothesis.placements.find((placement) => placement.cells.includes(cell));
      const outcomeKey = hit ? `hit:${hit.key}` : "miss";
      let bucket = byOutcome.get(outcomeKey);
      if (!bucket) {
        bucket = {
          outcome: hit ? { kind: "hit", placement: hit } : { kind: "miss" },
          hypotheses: new Map(),
          weight: 0,
        };
        byOutcome.set(outcomeKey, bucket);
      }
      const residual = hit
        ? hypothesis.placements.filter((placement) => placement.key !== hit.key)
        : hypothesis.placements;
      const key = layoutKey(residual);
      const prior = bucket.hypotheses.get(key);
      if (prior) prior.weight += hypothesis.weight;
      else bucket.hypotheses.set(key, { key, placements: residual, weight: hypothesis.weight });
      bucket.weight += hypothesis.weight;
    }

    const branches = [];
    for (const bucket of byOutcome.values()) {
      const unavailableMask = bucket.outcome.kind === "hit"
        ? state.unavailableMask | bucket.outcome.placement.mask
        : state.unavailableMask | bit(cell);
      branches.push({
        outcome: bucket.outcome,
        weight: bucket.weight,
        state: {
          hypotheses: Array.from(bucket.hypotheses.values()),
          unavailableMask,
        },
      });
    }
    return branches;
  }

  function candidateCells(state, cellCount) {
    const metrics = candidateMetrics(state, cellCount);
    const cells = [];
    for (let cell = 0; cell < cellCount; cell += 1) {
      if (!hasBit(state.unavailableMask, cell) && metrics.probability[cell] > 0) cells.push(cell);
    }
    return { cells, metrics };
  }

  function gcd(a, b) {
    let x = Math.abs(a);
    let y = Math.abs(b);
    while (y) [x, y] = [y, x % y];
    return x || 1;
  }

  function stateKey(state) {
    let divisor = 0;
    for (const hypothesis of state.hypotheses) divisor = gcd(divisor, hypothesis.weight);
    const hypotheses = state.hypotheses
      .map((hypothesis) => `${hypothesis.key}@${hypothesis.weight / divisor}`)
      .sort()
      .join(";");
    return `${state.unavailableMask.toString(36)}#${hypotheses}`;
  }

  function exactPlan(state, cellCount, options = {}) {
    const maxStates = options.maxStates ?? 25000;
    const memo = new Map();
    let visitedStates = 0;

    function value(current) {
      if (remainingObjects(current) === 0) return 0;
      const key = stateKey(current);
      if (memo.has(key)) return memo.get(key);
      visitedStates += 1;
      if (visitedStates > maxStates) throw new Error("EXACT_BUDGET_EXCEEDED");

      const { cells } = candidateCells(current, cellCount);
      if (!cells.length) return Infinity;
      const total = stateWeight(current);
      let best = Infinity;
      for (const cell of cells) {
        let expected = 1;
        for (const branch of branchState(current, cell)) {
          expected += (branch.weight / total) * value(branch.state);
        }
        if (expected < best) best = expected;
      }
      memo.set(key, best);
      return best;
    }

    const scores = Array(cellCount).fill(null);
    const total = stateWeight(state);
    const { cells } = candidateCells(state, cellCount);
    for (const cell of cells) {
      let expected = 1;
      for (const branch of branchState(state, cell)) {
        expected += (branch.weight / total) * value(branch.state);
      }
      scores[cell] = expected;
    }
    const finite = scores.filter((score) => Number.isFinite(score));
    return {
      scores,
      bestValue: finite.length ? Math.min(...finite) : Infinity,
      visitedStates,
      exact: true,
    };
  }

  function heuristicValue(state, cellCount) {
    const remaining = remainingObjects(state);
    if (!remaining) return 0;
    const { metrics } = candidateCells(state, cellCount);
    const maxProbability = Math.max(...metrics.probability, 0);
    return maxProbability > 0 ? remaining / maxProbability : Infinity;
  }

  function approximatePlan(state, cellCount, options = {}) {
    const depth = options.depth ?? 2;
    const beamWidth = options.beamWidth ?? 7;
    const memo = new Map();

    function value(current, remainingDepth) {
      if (remainingObjects(current) === 0) return 0;
      if (remainingDepth <= 0) return heuristicValue(current, cellCount);
      const key = `${remainingDepth}:${stateKey(current)}`;
      if (memo.has(key)) return memo.get(key);
      const { cells, metrics } = candidateCells(current, cellCount);
      if (!cells.length) return Infinity;
      const ranked = cells
        .sort((a, b) => {
          const gainA = metrics.expectedReveal[a] + metrics.probability[a];
          const gainB = metrics.expectedReveal[b] + metrics.probability[b];
          return gainB - gainA;
        })
        .slice(0, beamWidth);
      const total = stateWeight(current);
      let best = Infinity;
      for (const cell of ranked) {
        let expected = 1;
        for (const branch of branchState(current, cell)) {
          expected += (branch.weight / total) * value(branch.state, remainingDepth - 1);
        }
        if (expected < best) best = expected;
      }
      memo.set(key, best);
      return best;
    }

    const scores = Array(cellCount).fill(null);
    const total = stateWeight(state);
    const { cells } = candidateCells(state, cellCount);
    for (const cell of cells) {
      let expected = 1;
      for (const branch of branchState(state, cell)) {
        expected += (branch.weight / total) * value(branch.state, depth - 1);
      }
      scores[cell] = expected;
    }
    const finite = scores.filter((score) => Number.isFinite(score));
    return {
      scores,
      bestValue: finite.length ? Math.min(...finite) : Infinity,
      exact: false,
      depth,
      beamWidth,
    };
  }

  function solve(config, options = {}) {
    const rows = Math.max(1, Math.floor(Number(config.rows) || 1));
    const cols = Math.max(1, Math.floor(Number(config.cols) || 1));
    const cellCount = rows * cols;
    const forbiddenMask = BigInt(config.forbiddenMask ?? 0n);
    const requiredMask = BigInt(config.requiredMask ?? 0n) & ~forbiddenMask;
    const shapes = normalizeShapes(config.shapes ?? []);
    const exactLimit = options.exactLayoutLimit ?? 20000;
    const enumerated = enumerateLayouts(rows, cols, shapes, forbiddenMask, exactLimit, requiredMask);
    let layouts = enumerated.layouts;
    let layoutMode = "exact";
    let sampleInfo = null;

    if (enumerated.truncated) {
      sampleInfo = sampleLayouts(rows, cols, shapes, forbiddenMask, {
        target: options.sampleTarget ?? 4000,
        maxAttempts: options.maxSampleAttempts,
        random: options.random,
        requiredMask,
      });
      if (sampleInfo.layouts.length) {
        layouts = sampleInfo.layouts;
      } else {
        layouts = enumerated.layouts;
        sampleInfo = { ...sampleInfo, accepted: layouts.length, fallback: "enumerated-prefix" };
      }
      layoutMode = "sample";
    }

    if (!layouts.length) {
      const noObjects = shapes.length === 0;
      return {
        ok: noObjects && requiredMask === 0n,
        reason: noObjects && requiredMask === 0n ? "NO_OBJECTS" : "NO_LAYOUTS",
        rows,
        cols,
        layouts: 0,
        layoutMode,
        probability: Array(cellCount).fill(0),
        expectedReveal: Array(cellCount).fill(0),
        strategy: Array(cellCount).fill(null),
        bestCells: [],
        expectedRemainingFlips: noObjects && requiredMask === 0n ? 0 : Infinity,
        plannerMode: "none",
      };
    }

    const state = { hypotheses: compressLayouts(layouts), unavailableMask: forbiddenMask | requiredMask };
    const metrics = candidateMetrics(state, cellCount);
    const candidateCount = metrics.probability.filter((value) => value > 0).length;
    let plan;
    let plannerMode = "approx";
    const canTryExact = layoutMode === "exact"
      && state.hypotheses.length <= (options.exactPlanLayoutLimit ?? 80)
      && candidateCount <= (options.exactPlanCellLimit ?? 16);

    if (canTryExact) {
      try {
        plan = exactPlan(state, cellCount, { maxStates: options.maxPlanStates ?? 25000 });
        plannerMode = "exact";
      } catch (error) {
        if (error.message !== "EXACT_BUDGET_EXCEEDED") throw error;
      }
    }
    if (!plan) {
      plan = approximatePlan(state, cellCount, {
        depth: options.lookaheadDepth ?? 2,
        beamWidth: options.beamWidth ?? 7,
      });
    }

    const tolerance = 1e-9;
    const bestCells = plan.scores
      .map((score, cell) => ({ score, cell }))
      .filter(({ score }) => Number.isFinite(score) && Math.abs(score - plan.bestValue) <= tolerance)
      .map(({ cell }) => cell);
    const maxSampleError95 = layoutMode === "sample" && layouts.length
      ? 1.96 * Math.sqrt(0.25 / layouts.length)
      : 0;

    return {
      ok: true,
      rows,
      cols,
      layouts: layoutMode === "exact" ? layouts.length : sampleInfo.accepted,
      uniqueLayouts: state.hypotheses.length,
      layoutMode,
      probability: metrics.probability,
      expectedReveal: metrics.expectedReveal,
      strategy: plan.scores,
      bestCells,
      expectedRemainingFlips: plan.bestValue,
      plannerMode,
      maxSampleError95,
      sampleAttempts: sampleInfo?.attempts ?? 0,
      samplingFallback: sampleInfo?.fallback ?? null,
      planDetails: plan,
    };
  }

  return {
    bit,
    hasBit,
    normalizeShapes,
    generatePlacements,
    enumerateLayouts,
    sampleLayouts,
    compressLayouts,
    candidateMetrics,
    branchState,
    exactPlan,
    approximatePlan,
    solve,
  };
});
