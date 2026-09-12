/**
 * DeepTest per-test attribution inside the Karma browser. Loaded as a
 * classic script after Jasmine (the deeptest framework appends it to the
 * file list), before any spec runs.
 *
 * Karma keeps the live Istanbul counters in window.__coverage__. This
 * reporter snapshots the statement counters before every spec and diffs
 * them after it; every statement whose count rose ran under that spec.
 * Nothing is mapped here: the counters, with each file's statementMap and
 * inputSourceMap sent once, go to the Karma server through __karma__.info,
 * and the Node side (karma.cjs) turns them into lines with the same code
 * every other runner uses. Plain ES5 on purpose: it must run in whatever
 * browser the project tests in, and it must never throw.
 */
(function () {
  var karma = window.__karma__;
  if (!karma || typeof jasmine === 'undefined') {
    return;
  }
  var before = {};
  var sentMaps = {};

  function counters() {
    var cov = window.__coverage__;
    var snap = {};
    if (!cov) {
      return snap;
    }
    for (var file in cov) {
      var s = cov[file] && cov[file].s;
      if (s) {
        var copy = {};
        for (var id in s) {
          copy[id] = s[id];
        }
        snap[file] = copy;
      }
    }
    return snap;
  }

  function specFile(result) {
    // Jasmine 4+ reports the file a spec was defined in; through Karma it is
    // a URL such as http://localhost:9876/base/src/app/greet.spec.ts.
    var name = result && result.filename ? String(result.filename) : '';
    var m = /\/base\/(.*?)(\?.*)?$/.exec(name);
    return m ? m[1] : name || '?';
  }

  jasmine.getEnv().addReporter({
    specStarted: function () {
      try {
        before = counters();
      } catch (e) {
        before = {};
      }
    },
    specDone: function (result) {
      try {
        var cov = window.__coverage__ || {};
        var after = counters();
        var files = {};
        var maps = {};
        for (var file in after) {
          var prev = before[file] || {};
          var hit = [];
          for (var id in after[file]) {
            if ((after[file][id] || 0) > (prev[id] || 0)) {
              hit.push(id);
            }
          }
          if (hit.length > 0) {
            files[file] = hit;
            if (!sentMaps[file] && cov[file]) {
              sentMaps[file] = true;
              maps[file] = { statementMap: cov[file].statementMap, inputSourceMap: cov[file].inputSourceMap };
            }
          }
        }
        karma.info({ deeptest: { test: specFile(result) + '::' + (result.fullName || '?'), files: files, maps: maps } });
      } catch (e) {
        // Never fail the user's tests over attribution.
      }
    },
  });
})();
