/**
 * DeepTest per-test attribution for Istanbul-instrumented code.
 *
 * Jest (babel-plugin-istanbul) keeps the live counters in
 * `globalThis.__coverage__`; Vitest's istanbul provider uses
 * `globalThis.__VITEST_COVERAGE__`. Both are keyed by absolute file path, with `s` (statement id -> hit count) and `statementMap`
 * (statement id -> {start, end}). Snapshot the counters before each test,
 * diff after it, and every statement whose count rose was executed by that
 * test. Written as one JSON line per test into a file per worker process.
 *
 * Pure Node, no dependencies, loaded inside the test runner's worker. It
 * must never throw: a failure here must not fail the user's tests.
 */
'use strict';
const fs = require('node:fs');
const path = require('node:path');

const dir = process.env.DEEPTEST_ATTRIBUTION_DIR;
const outFile = dir ? path.join(dir, `attr-${process.pid}.jsonl`) : undefined;

/** Jest keeps the counters in __coverage__, Vitest's istanbul provider in __VITEST_COVERAGE__. */
function liveCoverage() {
  return globalThis.__VITEST_COVERAGE__ || globalThis.__coverage__;
}

function counters() {
  const cov = liveCoverage();
  if (!cov || typeof cov !== 'object') {
    return {};
  }
  const snap = {};
  for (const file of Object.keys(cov)) {
    const s = cov[file] && cov[file].s;
    if (s) {
      snap[file] = Object.assign({}, s);
    }
  }
  return snap;
}

/*
 * Vitest instruments esbuild's output, so its live statementMap is in
 * transformed coordinates; the provider remaps to the source at the end
 * using `inputSourceMap` on each file entry. We have to do the same, or a
 * stripped blank line shifts every attribution below it. Jest's babel
 * plugin works on the original AST and needs no remap. This is a minimal
 * source-map decoder: VLQ mappings to "generated line/col -> original line".
 */
const VLQ = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const VLQ_INDEX = {};
for (let i = 0; i < VLQ.length; i += 1) {
  VLQ_INDEX[VLQ[i]] = i;
}

function decodeVlq(segment) {
  const out = [];
  let value = 0;
  let shift = 0;
  for (const ch of segment) {
    const digit = VLQ_INDEX[ch];
    if (digit === undefined) {
      return out;
    }
    const cont = digit & 32;
    value += (digit & 31) << shift;
    if (cont) {
      shift += 5;
    } else {
      const negative = value & 1;
      value >>= 1;
      out.push(negative ? -value : value);
      value = 0;
      shift = 0;
    }
  }
  return out;
}

/** Returns, per generated line (0-based), a sorted list of [genCol, origLine] pairs. */
function decodeMappings(mappings) {
  const lines = [];
  let srcIdx = 0;
  let origLine = 0;
  let origCol = 0;
  for (const lineText of String(mappings).split(';')) {
    const segments = [];
    let genCol = 0;
    if (lineText) {
      for (const seg of lineText.split(',')) {
        const fields = decodeVlq(seg);
        if (fields.length === 0) {
          continue;
        }
        genCol += fields[0];
        if (fields.length >= 4) {
          srcIdx += fields[1];
          origLine += fields[2];
          origCol += fields[3];
          segments.push([genCol, origLine]);
        }
      }
    }
    lines.push(segments);
  }
  return lines;
}

const decodedMaps = new Map();

/** Original 1-based line for a generated 1-based line / 0-based column, or the generated line when there is no map. */
function originalLine(fileCov, line, column) {
  const map = fileCov && fileCov.inputSourceMap;
  if (!map || !map.mappings) {
    return line;
  }
  let decoded = decodedMaps.get(map);
  if (!decoded) {
    decoded = decodeMappings(map.mappings);
    decodedMaps.set(map, decoded);
  }
  const segments = decoded[line - 1];
  if (!segments || segments.length === 0) {
    return line;
  }
  let best = segments[0];
  for (const seg of segments) {
    if (seg[0] <= column) {
      best = seg;
    } else {
      break;
    }
  }
  return best[1] + 1;
}

let before = {};

function begin() {
  try {
    before = counters();
  } catch {
    before = {};
  }
}

function end(testId) {
  if (!outFile) {
    return;
  }
  try {
    const cov = liveCoverage() || {};
    const after = counters();
    const files = {};
    for (const file of Object.keys(after)) {
      const prev = before[file] || {};
      const map = cov[file] && cov[file].statementMap;
      if (!map) {
        continue;
      }
      const lines = new Set();
      for (const id of Object.keys(after[file])) {
        if ((after[file][id] || 0) > (prev[id] || 0)) {
          const stmt = map[id];
          if (stmt && stmt.start && typeof stmt.start.line === 'number') {
            lines.add(originalLine(cov[file], stmt.start.line, stmt.start.column || 0));
          }
        }
      }
      if (lines.size > 0) {
        files[file] = Array.from(lines).sort((a, b) => a - b);
      }
    }
    fs.appendFileSync(outFile, `${JSON.stringify({ test: testId, files })}\n`);
  } catch {
    // Never fail the user's tests over attribution.
  }
}

module.exports = { begin, end, decodeMappings, originalLine };
