"use strict";

importScripts("solver.js?v=5");

self.addEventListener("message", (event) => {
  const { id, config, options } = event.data;
  try {
    const result = self.GridStrategySolver.solve(config, options);
    self.postMessage({ id, result });
  } catch (error) {
    self.postMessage({ id, error: error instanceof Error ? error.message : String(error) });
  }
});
