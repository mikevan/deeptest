/**
 * Witness: the runtime. One global, `globalThis.__witness__`, that
 * instrumented files report to, and an Istanbul-shaped view of the same
 * counters at `globalThis.__coverage__` for reporters that expect it.
 *
 * What it records that Istanbul does not: for every statement, decision
 * outcome, and function entry, the id of the test that was running. The
 * hooks tell it which test that is (begin/end); the per-test record goes
 * out as one JSON line per test, the same shape the other DeepTest hooks
 * write, so the driver reads all of them with one reader.
 *
 * Plain CommonJS with no dependencies: it is copied into the project's
 * .deeptest/hooks folder and loaded by the project's Node. It must never
 * throw into the code it is measuring.
 */
'use strict';
const fs = require('node:fs');
const path = require('node:path');

const attributionDir = process.env.DEEPTEST_ATTRIBUTION_DIR;
const attributionFile = attributionDir ? path.join(attributionDir, `attr-witness-${process.pid}.jsonl`) : undefined;

const files = new Map(); // handle -> { path, cov, W }
let currentTest = undefined;
let hits = new Map(); // path -> Set(line) for the current test
let outcomes = new Map(); // path -> Map(branchId -> Set(index)) for the current test
let entered = new Map(); // path -> Set(fnId) for the current test

function coverageView() {
  if (!globalThis.__coverage__) {
    globalThis.__coverage__ = {};
  }
  return globalThis.__coverage__;
}

function zeros(map, branches) {
  const out = {};
  for (const id of Object.keys(map)) {
    out[id] = branches ? map[id].locations.map(() => 0) : 0;
  }
  return out;
}

function noteLine(filePath, line) {
  if (currentTest === undefined) {
    return;
  }
  let set = hits.get(filePath);
  if (!set) {
    set = new Set();
    hits.set(filePath, set);
  }
  set.add(line);
}

function noteOutcome(filePath, branchId, index) {
  if (currentTest === undefined) {
    return;
  }
  let perFile = outcomes.get(filePath);
  if (!perFile) {
    perFile = new Map();
    outcomes.set(filePath, perFile);
  }
  let set = perFile.get(branchId);
  if (!set) {
    set = new Set();
    perFile.set(branchId, set);
  }
  set.add(index);
}

function noteEntry(filePath, fnId) {
  if (currentTest === undefined) {
    return;
  }
  let set = entered.get(filePath);
  if (!set) {
    set = new Set();
    entered.set(filePath, set);
  }
  set.add(fnId);
}

function makeHandle(filePath, cov) {
  const sm = cov.statementMap;
  const bm = cov.branchMap;
  const W = {
    s(id) {
      cov.s[id] += 1;
      noteLine(filePath, sm[id].start.line);
    },
    v(id, name, value) {
      cov.s[id] += 1;
      noteLine(filePath, sm[id].start.line);
      if (typeof value === 'function' && value.name === '' && name) {
        try {
          Object.defineProperty(value, 'name', { value: name, configurable: true });
        } catch {
          // a frozen function keeps its empty name
        }
      }
      return value;
    },
    f(id) {
      cov.f[id] += 1;
      noteEntry(filePath, id);
    },
    b(id, value) {
      const index = value ? 0 : 1;
      cov.b[id][index] += 1;
      noteOutcome(filePath, id, index);
      noteLine(filePath, bm[id].locations[index].start.line || bm[id].line);
      return value;
    },
    l(id, index, value) {
      cov.b[id][index] += 1;
      noteOutcome(filePath, id, index);
      return value;
    },
    c(id, index) {
      cov.b[id][index] += 1;
      noteOutcome(filePath, id, index);
    },
  };
  return W;
}

const witness = {
  /** Called by the loader, in the loading thread, right after instrumenting a file. */
  register(handle, filePath, maps) {
    const cov = {
      path: filePath,
      statementMap: maps.statementMap,
      fnMap: maps.fnMap,
      branchMap: maps.branchMap,
      s: zeros(maps.statementMap, false),
      f: zeros(maps.fnMap, false),
      b: zeros(maps.branchMap, true),
    };
    coverageView()[filePath] = cov;
    const W = makeHandle(filePath, cov);
    files.set(handle, { path: filePath, cov, W });
    return W;
  },
  /** Called by the instrumented file's prologue. */
  file(handle) {
    const entry = files.get(handle);
    if (!entry) {
      // Instrumented by a loader this process never ran: count nothing, break nothing.
      const noop = () => undefined;
      return { s: noop, f: noop, c: noop, v: (_id, _name, value) => value, b: (_id, value) => value, l: (_id, _i, value) => value };
    }
    return entry.W;
  },
  /** A test is starting. */
  begin(testId) {
    currentTest = testId;
    hits = new Map();
    outcomes = new Map();
    entered = new Map();
  },
  /** The current test ended: write its record and forget it. */
  end() {
    if (currentTest === undefined) {
      return;
    }
    try {
      if (attributionFile) {
        const record = { test: currentTest, files: {}, outcomes: {}, entered: {} };
        for (const [file, lines] of hits) {
          record.files[file] = Array.from(lines).sort((a, b) => a - b);
        }
        for (const [file, perFile] of outcomes) {
          record.outcomes[file] = {};
          for (const [id, set] of perFile) {
            record.outcomes[file][id] = Array.from(set).sort((a, b) => a - b);
          }
        }
        for (const [file, set] of entered) {
          record.entered[file] = Array.from(set).sort((a, b) => a - b);
        }
        fs.appendFileSync(attributionFile, `${JSON.stringify(record)}\n`);
      }
    } catch {
      // Never fail the user's tests over attribution.
    }
    currentTest = undefined;
  },
  /** The whole-run counters, Istanbul's shape, written where the driver reads them. */
  writeReport(dir) {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'coverage-final.json'), JSON.stringify(coverageView()));
  },
  get current() {
    return currentTest;
  },
};

if (!globalThis.__witness__) {
  globalThis.__witness__ = witness;
}

module.exports = globalThis.__witness__;
