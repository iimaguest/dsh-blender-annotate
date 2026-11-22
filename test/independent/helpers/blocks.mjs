/**
 * Load the code under test without a browser:
 * - the resolver block of dev/resolve.js (pure functions);
 * - the shipped viewer, by evaluating lib/client.js's factory in a VM context
 *   with a stub WebGL context, a stub canvas and a manual requestAnimationFrame.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { runInNewContext } from "node:vm";
import { ROOT } from "./blender.mjs";

export function resolveBlockSource() {
  const source = readFileSync(join(ROOT, "dev", "resolve.js"), "utf8");
  return source.slice(source.indexOf("\n", source.indexOf("/* @resolve:start")) + 1, source.indexOf("/* @resolve:end"));
}

export function loadResolver() {
  return new Function(resolveBlockSource() + "\nreturn { createResolver, selectorOf, describeResolved, faceParameters, m4invert, rowsToColumnMajor };")();
}

/** A WebGL stand-in: every call is a no-op returning a handle; shaders always compile. */
export function glStub() {
  const constants = { UNSIGNED_BYTE: 5121, UNSIGNED_SHORT: 5123, UNSIGNED_INT: 5125, FLOAT: 5126, TRIANGLES: 4, LINES: 1 };
  const base = {
    getShaderParameter: () => true,
    getProgramParameter: () => true,
    getAttribLocation: () => 0,
    getUniformLocation: () => ({}),
    getShaderInfoLog: () => "",
    getProgramInfoLog: () => "",
  };
  return new Proxy(base, {
    get(target, prop) {
      if (prop in target) return target[prop];
      if (typeof prop === "string" && /^[A-Z0-9_]+$/.test(prop)) return constants[prop] ?? 0;
      return () => ({});
    },
  });
}

export function canvasStub({ width = 800, height = 600, left = 0, top = 0, gl = glStub() } = {}) {
  const listeners = {};
  return {
    width: 0,
    height: 0,
    clientWidth: width,
    clientHeight: height,
    getContext: (kind) => (kind === "webgl2" || kind === "webgl" ? gl : null),
    getBoundingClientRect: () => ({ left, top, width, height, right: left + width, bottom: top + height, x: left, y: top }),
    addEventListener: (type, fn) => { (listeners[type] ||= []).push(fn); },
    removeEventListener: (type, fn) => { listeners[type] = (listeners[type] || []).filter((f) => f !== fn); },
    setPointerCapture() {},
    releasePointerCapture() {},
    dispatch(type, event) {
      for (const fn of listeners[type] || []) fn({ preventDefault() {}, pointerId: 1, button: 0, ...event });
    },
    listeners,
  };
}

/** Evaluate lib/client.js and return its exported viewer factory plus frame control. */
export function loadShippedViewer({ dpr = 1 } = {}) {
  const source = readFileSync(join(ROOT, "lib", "client.js"), "utf8");
  let registration;
  const frames = [];
  const window = {
    __ModuleLoader__: { load: (value) => { registration = value; } },
    addEventListener() {},
    removeEventListener() {},
    devicePixelRatio: dpr,
  };
  const sandbox = {
    window,
    globalThis: window,
    console,
    TextDecoder,
    performance,
    requestAnimationFrame: (fn) => { frames.push(fn); return frames.length; },
    cancelAnimationFrame() {},
  };
  runInNewContext(source, sandbox);
  const reactStub = { createElement: () => null, Fragment: "f", useRef: (v) => ({ current: v }), useState: (v) => [v, () => {}], useEffect() {}, useCallback: (f) => f, useLayoutEffect() {} };
  const exports = registration.factory((name) => (name === "react" ? reactStub : {}));
  return {
    createViewer: exports.__createViewer,
    /** Run every queued animation frame once (the viewer re-queues itself). */
    flush(time = 16) {
      const pending = frames.splice(0, frames.length);
      for (const fn of pending) fn(time);
    },
  };
}

export function arrayBufferOf(buffer) {
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
}
