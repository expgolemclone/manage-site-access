import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Script, createContext } from "node:vm";
import { before, test } from "node:test";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const source = readFileSync(join(root, "src/manage-site-access.js"), "utf8");
const google = JSON.parse(readFileSync(join(root, "rules/google.json"), "utf8"));
let generated;

function build(directory) {
  return spawnSync("pwsh", ["-NoProfile", "-File", join(directory, "build.ps1")], {
    encoding: "utf8",
    timeout: 30_000,
  });
}

function fixture(run) {
  const directory = mkdtempSync(join(tmpdir(), "manage-site-access-"));
  try {
    mkdirSync(join(directory, "rules"));
    mkdirSync(join(directory, "src"));
    writeFileSync(join(directory, "build.ps1"), readFileSync(join(root, "build.ps1")));
    writeFileSync(join(directory, "src/manage-site-access.js"), source);
    return run(directory);
  } finally {
    rmSync(directory, { recursive: true });
  }
}

function execute(script, href) {
  let current = new URL(href);
  const redirects = [];
  const listeners = new Map();
  const intervals = [];
  const context = createContext({
    location: {
      get hostname() { return current.hostname; },
      get pathname() { return current.pathname; },
      replace: (target) => redirects.push(target),
    },
    addEventListener: (name, callback) => listeners.set(name, callback),
    setInterval: (callback, delay) => intervals.push({ callback, delay }),
  });
  new Script(script).runInContext(context, { timeout: 1000 });
  return {
    redirects, listeners, intervals,
    navigate: (href) => { current = new URL(href); },
  };
}

before(() => {
  const result = build(root);
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  generated = readFileSync(join(root, "dist/manage-site-access.user.js"), "utf8");
});

test("build produces a standalone, deterministic userscript", () => {
  assert.ok(!generated.includes("__SITE_RULES__"));
  assert.ok(!generated.startsWith("\uFEFF"));
  for (const line of [
    "// @match        http://*/*", "// @match        https://*/*",
    "// @run-at       document-start", "// @grant        none", "// @noframes",
  ]) assert.ok(generated.includes(line), line);
  new Script(generated);
  const result = build(root);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal(readFileSync(join(root, "dist/manage-site-access.user.js"), "utf8"), generated);
});

const blocked = [
  "https://google.com/",
  "https://www.google.com/",
  "https://www.google.com/?q=test",
  "https://www.google.com/webhp?hl=ja",
  "https://google.com/search?q=test",
  "https://www.google.com/search?q=test&tbm=isch",
  "http://www.google.com/search?q=test",
  "https://www.google.com/search/?q=test",
  "https://www.google.com/search///?q=test",
  "https://WWW.GOOGLE.COM/search?q=test",
  "https://www.google.com./search?q=test",
];
for (const href of blocked) {
  test("blocks " + href, () => {
    const state = execute(generated, href);
    assert.deepEqual(state.redirects, ["about:blank"]);
    assert.equal(state.intervals.length, 0);
    assert.equal(state.listeners.size, 0);
  });
}

const allowed = [
  "https://mail.google.com/mail/u/0/",
  "https://accounts.google.com/",
  "https://accounts.google.com/search",
  "https://drive.google.com/drive/u/0/",
  "https://calendar.google.com/calendar/u/0/r",
  "https://docs.google.com/document/",
  "https://meet.google.com/",
  "https://maps.google.com/",
  "https://photos.google.com/",
  "https://translate.google.com/",
  "https://www.google.com/maps",
  "https://www.google.com/maps/search/cafe",
  "https://www.google.com/url?q=https://example.com",
  "https://www.google.com/searching",
  "https://www.google.com/search/example",
  "https://www.google.com/SEARCH",
  "https://www.google.co.jp/search?q=test",
  "https://news.google.com/search?q=test",
  "https://example.com/search?q=test",
  "https://www.google.com.example.com/search",
  "https://notgoogle.com/search",
  "https://example.com/?next=https://www.google.com/search",
];
for (const href of allowed) {
  test("allows " + href, () => {
    const state = execute(generated, href);
    assert.deepEqual(state.redirects, []);
    if (!google.hosts.includes(new URL(href).hostname)) {
      assert.equal(state.intervals.length, 0);
      assert.equal(state.listeners.size, 0);
    }
  });
}

for (const event of ["pageshow", "popstate"]) {
  test("rechecks navigation on " + event, () => {
    const state = execute(generated, "https://www.google.com/maps");
    state.navigate("https://www.google.com/search?q=test");
    state.listeners.get(event)();
    assert.deepEqual(state.redirects, ["about:blank"]);
  });
}

test("detects History API path changes without wrapping browser APIs", () => {
  const state = execute(generated, "https://www.google.com/maps");
  assert.equal(state.intervals.length, 1);
  assert.equal(state.intervals[0].delay, 500);
  state.intervals[0].callback();
  assert.deepEqual(state.redirects, []);
  state.navigate("https://www.google.com/search?q=test");
  state.intervals[0].callback();
  assert.deepEqual(state.redirects, ["about:blank"]);
});

test("supports adding a whole-site rule with explicit subdomain matching", () => {
  fixture((directory) => {
    writeFileSync(join(directory, "rules/google.json"), JSON.stringify(google));
    writeFileSync(join(directory, "rules/example.json"), JSON.stringify({
      hosts: ["example.org"], includeSubdomains: true, paths: [],
    }));
    const result = build(directory);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    const script = readFileSync(join(directory, "dist/manage-site-access.user.js"), "utf8");
    for (const href of ["https://example.org/", "https://a.example.org/anything"]) {
      assert.deepEqual(execute(script, href).redirects, ["about:blank"]);
    }
    for (const href of ["https://notexample.org/", "https://example.org.evil.test/"]) {
      assert.deepEqual(execute(script, href).redirects, []);
    }
    assert.deepEqual(execute(script, "https://mail.google.com/").redirects, []);
    assert.deepEqual(execute(script, "https://www.google.com/search").redirects, ["about:blank"]);
  });
});

const invalidRules = [
  null,
  [],
  { ...google, extra: true },
  { hosts: google.hosts, paths: google.paths },
  { ...google, hosts: [] },
  { ...google, hosts: "google.com" },
  { ...google, hosts: ["Google.com"] },
  { ...google, hosts: ["google.com.evil/"] },
  { ...google, hosts: ["*.google.com"] },
  { ...google, hosts: ["google.com", "google.com"] },
  { ...google, hosts: [null] },
  { ...google, includeSubdomains: "false" },
  { ...google, paths: "/" },
  { ...google, paths: [null] },
  { ...google, paths: ["search"] },
  { ...google, paths: ["/search/"] },
  { ...google, paths: ["/search?q=test"] },
  { ...google, paths: ["/search#test"] },
  { ...google, paths: ["/a b"] },
  { ...google, paths: ["/a\\b"] },
  { ...google, paths: ["/search", "/search"] },
];
for (const [index, rule] of invalidRules.entries()) {
  test("rejects invalid rule " + index, () => {
    fixture((directory) => {
      writeFileSync(join(directory, "rules/invalid.json"), JSON.stringify(rule));
      const result = build(directory);
      assert.equal(result.error, undefined);
      assert.notEqual(result.status, 0);
    });
  });
}

test("preserves distinct case-sensitive paths", () => {
  fixture((directory) => {
    writeFileSync(join(directory, "rules/example.json"), JSON.stringify({
      hosts: ["example.org"], includeSubdomains: false, paths: ["/search", "/SEARCH"],
    }));
    const result = build(directory);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    const script = readFileSync(join(directory, "dist/manage-site-access.user.js"), "utf8");
    for (const path of ["/search", "/SEARCH"]) {
      assert.deepEqual(execute(script, "https://example.org" + path).redirects, ["about:blank"]);
    }
    assert.deepEqual(execute(script, "https://example.org/Search").redirects, []);
  });
});

test("rejects an empty rule directory", () => {
  fixture((directory) => assert.notEqual(build(directory).status, 0));
});

test("rejects malformed JSON", () => {
  fixture((directory) => {
    writeFileSync(join(directory, "rules/invalid.json"), "{");
    assert.notEqual(build(directory).status, 0);
  });
});

test("rejects a missing or duplicated build marker", () => {
  fixture((directory) => {
    writeFileSync(join(directory, "rules/google.json"), JSON.stringify(google));
    for (const invalid of [
      source.replace("__SITE_RULES__", "[]"),
      source + "\n// __SITE_RULES__",
    ]) {
      writeFileSync(join(directory, "src/manage-site-access.js"), invalid);
      assert.notEqual(build(directory).status, 0);
    }
  });
});
