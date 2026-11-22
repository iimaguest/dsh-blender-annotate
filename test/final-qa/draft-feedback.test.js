/** Execute the shipped event handlers in isolation: no DOM/React/visual claims. */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../../lib/client.js", import.meta.url), "utf8");
function section(start, end) {
  const a = source.indexOf(start), b = source.indexOf(end, a + start.length);
  assert.ok(a >= 0 && b > a, `shipped handler markers ${start} / ${end}`);
  return source.slice(a, b);
}
function clickHandler(env) {
  return new Function("env", `const {viewerRef, annotating, state, draft, flash, t,
    clickRef, resolverRef, target, absolutePath, version, payload, anchorFor,
    setDraft, setSelectedId} = env;\n` +
    section("clickRef.current = (clientX, clientY) =>", "const changeTarget =") +
    "\nreturn clickRef.current;")(env);
}
function sendHandler(env) {
  return new Function("env", `const {viewerRef, annotations, draft, flash, t,
    inputActions, buildMessage, name, absolutePath, composerDraft, canvasToFile,
    snapshotWithPins, attachFiles, console} = env;\n` +
    section("const send = async () =>", "const openSketch =") + "\nreturn send;")(env);
}

test("a second model click cannot discard a nonempty unsaved comment; empty draft remains replaceable", () => {
  const notices = [];
  let picks = 0, writes = 0;
  const draft = { id: "unsaved", comment: "  keep this change  " };
  const env = { viewerRef: { current: { pick: () => { picks++; return null; } } },
    annotating: true, state: "ready", draft, flash: (key) => notices.push(key),
    t: (key) => key, clickRef: {}, setDraft: () => writes++ };
  clickHandler(env)(100, 200);
  assert.deepEqual(notices, ["saveFirst"]);
  assert.equal(picks, 0, "guard runs before picking a replacement");
  assert.equal(writes, 0);
  assert.equal(draft.comment, "  keep this change  ");
  env.draft = { comment: " \n\t " };
  clickHandler(env)(100, 200);
  assert.equal(picks, 1, "whitespace-only draft is a positive control");
  assert.deepEqual(notices, ["saveFirst", "noHit"]);
});

function sendEnvironment(overrides = {}) {
  const events = { notices: [], composer: [], snapshots: 0, encodes: 0, attachments: 0 };
  const env = { viewerRef: { current: {} }, annotations: [{ id: "saved" }], draft: null,
    flash: (key) => events.notices.push(key), t: (key) => key,
    inputActions: { setDraft: (value) => events.composer.push(value),
      send: () => assert.fail("annotation action must not submit the conversation") },
    buildMessage: () => "ANNOTATIONS", name: "model.blend", absolutePath: "/qa/model.blend",
    composerDraft: "Existing draft", snapshotWithPins: () => { events.snapshots++; return {}; },
    canvasToFile: async () => { events.encodes++; return { name: "annotation.png" }; },
    attachFiles: () => { events.attachments++; return true; }, console: { warn() {} }, ...overrides };
  return { env, events };
}

test("Send is blocked for any pending draft, including an empty comment, before composer or snapshot side effects", async () => {
  for (const comment of ["", "not yet saved"]) {
    const { env, events } = sendEnvironment({ draft: { comment } });
    await sendHandler(env)();
    assert.deepEqual(events.notices, ["saveFirst"]);
    assert.deepEqual(events.composer, []);
    assert.equal(events.snapshots, 0);
    assert.equal(events.encodes, 0);
    assert.equal(events.attachments, 0);
  }
});

test("Send differentiates failed attachment/PNG encoding from success while preserving composer text without chat submission", async () => {
  for (const mode of ["attachment-false", "encode-reject", "success"]) {
    const { env, events } = sendEnvironment();
    if (mode === "attachment-false") env.attachFiles = () => { events.attachments++; return false; };
    if (mode === "encode-reject") env.canvasToFile = async () => { events.encodes++; throw new Error("PNG failed"); };
    await sendHandler(env)();
    assert.deepEqual(events.composer, ["Existing draft\n\nANNOTATIONS"]);
    assert.equal(events.snapshots, 1);
    assert.equal(events.encodes, 1);
    assert.equal(events.attachments, mode === "encode-reject" ? 0 : 1);
    assert.deepEqual(events.notices, [mode === "success" ? "sent" : "sentNoSnapshot"], mode);
  }
});
