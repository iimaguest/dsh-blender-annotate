/**
 * Independent QA: the annotation UI in lib/client.js rendered with real React
 * in jsdom. WebGL is stubbed (the viewer's CPU picking still runs), fetch serves
 * a real Blender export (test/fixtures/annotate-fixture.*, used as data only).
 * Covers persistence + stale flag, Send to chat (buildMessage), and copy.
 */
import { after, afterEach, before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { runInThisContext } from "node:vm";
import { JSDOM } from "jsdom";
import React, { act } from "react";
import { ROOT } from "./helpers/blender.mjs";
import { glStub } from "./helpers/blocks.mjs";

const PATH = "/Users/qa/models/annotate-fixture.blend";
const STORE = "dsh-blender-annotate:v1:" + PATH;
const sceneInfo = JSON.parse(readFileSync(join(ROOT, "test", "fixtures", "annotate-fixture.json"), "utf8"));
const glbBytes = readFileSync(join(ROOT, "test", "fixtures", "annotate-fixture.glb"));

let dom;
let createRoot;
let BlendBody;
let en;
let frames = [];
const fetchLog = [];
let fetchMode = "ok";
const mounted = new Set();

function installDom() {
  dom = new JSDOM("<!doctype html><html><head></head><body></body></html>", { url: "http://127.0.0.1/", pretendToBeVisual: true });
  const w = dom.window;
  globalThis.window = w;
  globalThis.document = w.document;
  globalThis.HTMLElement = w.HTMLElement;
  globalThis.Image = w.Image;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  globalThis.requestAnimationFrame = (fn) => { frames.push(fn); return frames.length; };
  globalThis.cancelAnimationFrame = () => {};
  const Canvas = w.HTMLCanvasElement.prototype;
  const gl = glStub();
  const ctx2d = new Proxy({}, { get: (t, p) => (p === "canvas" ? undefined : () => ({ addColorStop() {} })), set: () => true });
  Canvas.getContext = function (kind) { return kind === "2d" ? ctx2d : gl; };
  Canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: 400, height: 300, right: 400, bottom: 300, x: 0, y: 0 });
  Object.defineProperty(Canvas, "clientWidth", { get: () => 400, configurable: true });
  Object.defineProperty(Canvas, "clientHeight", { get: () => 300, configurable: true });
  Canvas.toBlob = function (cb) { cb(new w.Blob(["png"], { type: "image/png" })); };
  Canvas.toDataURL = () => "data:image/png;base64,";
  globalThis.fetch = async (url) => {
    const u = new URL(url, "http://127.0.0.1");
    fetchLog.push(u.searchParams.get("kind") + "@" + u.searchParams.get("v"));
    if (fetchMode === "fail") {
      return new Response(JSON.stringify({ ok: false, error: { code: "BLEND_EXPORT_FAILED", message: "Blender exited with code 1", detail: "Traceback (most recent call last): boom" } }), { status: 422 });
    }
    if (u.searchParams.get("kind") === "info") {
      return new Response(JSON.stringify({ ok: true, scene: sceneInfo, blender: "Blender 4.2.23 LTS", cache: { cached: false, elapsedMs: 900, glbBytes: glbBytes.length } }), { status: 200 });
    }
    return new Response(glbBytes, { status: 200 });
  };
}

function loadBundle() {
  const source = readFileSync(join(ROOT, "lib", "client.js"), "utf8");
  let registration;
  window.__ModuleLoader__ = { load: (value) => { registration = value; } };
  runInThisContext(source, { filename: "lib/client.js" });
  const exports = registration.factory((name) => (name === "react" ? React : {}));
  const ctx = {
    locale: { bind: () => (key) => key, register: (ns, dict) => { en = dict.en; } },
    documentPreviews: { register: () => {} },
    slots: { inject: (name, factory) => factory(), register: (spec, body) => { BlendBody = body; } },
    effect: (factory) => factory(),
    sessions: { scope: () => ({ get: () => ({ createDrafts: (sid, files) => files.map((f, i) => ({ id: "d" + i })) }) }) },
  };
  exports.apply(ctx);
}

const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));
async function flushFrames() {
  await act(async () => {
    const pending = frames.splice(0, frames.length);
    for (const fn of pending) fn(16);
  });
}

/** Mount the body; returns helpers bound to that mount. */
function mount(initial) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const drafts = [];
  const attachments = [];
  let props;
  const render = async (overrides) => {
    props = {
      content: { kind: "renderer", revision: 1, loaded() {}, failed() {} },
      resourceAddress: "file://" + PATH,
      useResource: () => ({ value: { absolutePath: PATH, version: overrides.version }, status: "ready" }),
      t: (key) => (en && key in en ? en[key] : key),
      routePath: "/api/blender-annotate",
      inputActions: { setDraft: (v) => drafts.push(v), addAttachments: (ids) => { attachments.push(ids); return true; } },
      useInput: (selector) => selector({ draft: overrides.composer ?? "" }),
      sessionId: "s1",
      createDraftsFor: () => (files) => files.map((f, i) => "file" + i),
    };
    await act(async () => { root.render(React.createElement(BlendBody, props)); });
  };
  const q = (sel) => container.querySelector(sel);
  const qa = (sel) => [...container.querySelectorAll(sel)];
  async function waitFor(predicate, label, ms = 4000) {
    const start = Date.now();
    while (!predicate()) {
      if (Date.now() - start > ms) throw new Error(`timed out waiting for ${label}; state=${q("[data-blend-state]")?.getAttribute("data-blend-state")}`);
      await act(async () => { await tick(10); });
    }
  }
  async function click(el) {
    await act(async () => { el.dispatchEvent(new window.MouseEvent("click", { bubbles: true })); });
  }
  async function pointerClick(x, y) {
    const canvas = q("[data-blend-canvas]");
    await act(async () => {
      for (const type of ["pointerdown", "pointerup"]) {
        const e = new window.MouseEvent(type, { bubbles: true, clientX: x, clientY: y, button: 0 });
        Object.defineProperty(e, "pointerId", { value: 1 });
        canvas.dispatchEvent(e);
      }
    });
  }
  async function type(el, text) {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set;
    await act(async () => {
      setter.call(el, text);
      el.dispatchEvent(new window.Event("input", { bubbles: true }));
    });
  }
  /** Click across the canvas until a draft opens (the model covers part of the view). */
  async function annotateSomewhere(comment) {
    if (q('[data-blend-action="annotate"]').getAttribute("data-active") !== "true") await click(q('[data-blend-action="annotate"]'));
    await flushFrames();
    for (let y = 150; y < 300 && !q("[data-blend-draft]"); y += 15) {
      for (let x = 200, k = 0; k < 26 && !q("[data-blend-draft]"); k += 1, x += (k % 2 ? 1 : -1) * k * 8) await pointerClick(x, y);
    }
    assert.ok(q("[data-blend-draft]"), "a click landed on the model and opened a draft");
    await type(q("[data-blend-draft] textarea"), comment);
    await click(q('[data-blend-action="save-annotation"]'));
  }
  const handle = {
    render, q, qa, waitFor, click, annotateSomewhere, drafts, attachments, container,
    unmount: async () => {
      if (!mounted.has(handle)) return;
      mounted.delete(handle);
      await act(async () => root.unmount());
      container.remove();
    },
    ready: () => waitFor(() => q("[data-blend-state]")?.getAttribute("data-blend-state") === "ready", "ready"),
    initial,
  };
  mounted.add(handle);
  return handle;
}

describe("annotation UI (React + jsdom)", () => {
  before(async () => {
    installDom();
    // react-dom probes for a DOM when it is first imported, so import it after jsdom is installed.
    ({ createRoot } = await import("react-dom/client"));
    const original = console.error;
    console.error = (...args) => { if (!/not wrapped in act/.test(String(args[0]))) original(...args); };
    loadBundle();
  });
  beforeEach(() => {
    window.localStorage.clear();
    fetchMode = "ok";
    frames = [];
  });
  afterEach(async () => {
    for (const m of [...mounted]) await m.unmount();
  });
  after(() => dom.window.close());

  it("the failure panel's log disclosure is labelled as the Blender log, not as annotation parameters", async () => {
    fetchMode = "fail";
    const m = mount();
    await m.render({ version: "v1" });
    await m.waitFor(() => m.q("[data-blend-state]")?.getAttribute("data-blend-state") === "failed", "failed");
    assert.match(m.q("[data-blend-error-message]").textContent, /exited with code 1/);
    const summary = m.q(".dsh-bp-details summary");
    assert.ok(summary, "details disclosure present");
    assert.equal(summary.textContent, "Blender log");
    await m.unmount();
  });

  it("saving an annotation persists it under the file path with the file version", async () => {
    const m = mount();
    await m.render({ version: "v1" });
    await m.ready();
    await m.annotateSomewhere("raise this by 2 mm");
    const stored = JSON.parse(window.localStorage.getItem(STORE));
    assert.equal(stored.version, "v1");
    assert.equal(stored.items.length, 1);
    assert.equal(stored.items[0].comment, "raise this by 2 mm");
    assert.equal(stored.items[0].stale, false);
    assert.ok(stored.items[0].resolved && stored.items[0].resolved.object, "resolved identity is stored");
    await m.unmount();
  });

  it("annotations stored for an older file version are flagged stale when the file is reopened", async () => {
    window.localStorage.setItem(STORE, JSON.stringify({ version: "v1", items: [{ id: "a1", target: "object", hit: { nodeName: "Body", point: [0, 0, 0] }, anchor: [0, 0, 0], resolved: null, comment: "old", stale: false, view: null }] }));
    const m = mount();
    await m.render({ version: "v2" });
    await m.ready();
    assert.match(m.q("[data-blend-annotations] .dsh-ba-meta").textContent, /file changed/);
    const stored = JSON.parse(window.localStorage.getItem(STORE));
    assert.equal(stored.version, "v2");
    assert.equal(stored.items[0].stale, true);
    await m.unmount();
  });

  it("annotations are flagged stale when the file changes while the preview stays open", async () => {
    const m = mount();
    await m.render({ version: "v1" });
    await m.ready();
    await m.annotateSomewhere("before the edit");
    fetchLog.length = 0;
    await m.render({ version: "v2" }); // the resource reports a new file version
    const versionBeforeReload = JSON.parse(window.localStorage.getItem(STORE)).version;
    await m.waitFor(() => fetchLog.includes("glb@v2"), "re-export of v2");
    await m.ready();
    const stored = JSON.parse(window.localStorage.getItem(STORE));
    const meta = m.q("[data-blend-annotations] .dsh-ba-meta")?.textContent ?? "";
    assert.deepEqual(
      { storedStale: stored.items[0].stale, shownStale: /file changed/.test(meta) },
      { storedStale: true, shownStale: true },
      `an annotation placed on v1 must be marked as recorded on an earlier version after v2 loads (stored version was already "${versionBeforeReload}" before the v2 export finished)`
    );
    await m.unmount();
  });

  it("Send to chat writes numbered annotation blocks after the existing composer text and attaches a snapshot", async () => {
    const m = mount();
    await m.render({ version: "v1", composer: "Please fix:" });
    await m.ready();
    await m.annotateSomewhere("first note");
    await m.annotateSomewhere("second `note`");
    await m.click(m.q('[data-blend-action="send"]'));
    await m.waitFor(() => m.attachments.length > 0, "snapshot attached");
    assert.equal(m.drafts.length, 1);
    const msg = m.drafts[0];
    assert.ok(msg.startsWith("Please fix:\n\n### 3D annotations — `annotate-fixture.blend`\nFile: `" + PATH + "`\n"), msg.slice(0, 200));
    assert.match(msg, /\*\*1\. first note\*\*\n- selector: `[^`]+`\n- target: point · precision: /);
    assert.match(msg, /\*\*2\. second `note`\*\*/);
    const stored = JSON.parse(window.localStorage.getItem(STORE));
    for (const item of stored.items) {
      const r = item.resolved;
      if (r.face !== null) assert.ok(msg.includes(`me.polygons[${r.face}]`), "bpy line per annotation");
      assert.ok(msg.includes(`object \`${r.object}\``));
    }
    assert.ok(!/recorded on an earlier version/.test(msg));
    assert.deepEqual(m.attachments[0], ["file0"]);
    await m.unmount();
  });

  it("deleting the last annotation removes the stored entry", async () => {
    const m = mount();
    await m.render({ version: "v1" });
    await m.ready();
    await m.annotateSomewhere("temporary");
    assert.ok(window.localStorage.getItem(STORE));
    const remove = m.qa("[data-blend-annotations] button").find((b) => b.textContent === "Delete");
    await m.click(remove);
    assert.equal(window.localStorage.getItem(STORE), null);
    await m.unmount();
  });
});
