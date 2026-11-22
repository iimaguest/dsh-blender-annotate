/**
 * Client bundle source for dsh-blender-annotate.
 *
 * Fork of dsh-preview-blender (MIT, 439436269-ctrl) with the annotation editor
 * of dsh-preview-snip (MIT, 439436269-ctrl). Adds point/face/edge/vertex/object
 * annotation on the 3D preview: every picked point is resolved to Blender
 * identities and parameters (dev/resolve.js) and can be sent to the composer.
 *
 * scripts/build-client.mjs replaces the viewer and resolver markers below with
 * dev/viewer.js and dev/resolve.js and writes lib/client.js. Edit the dev files,
 * then run `node scripts/build-client.mjs`.
 */
window.__ModuleLoader__.load({
  id: "dsh-blender-annotate",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

    const React = require("react");

    /* @viewer */

    /* @resolve */

    /** This package's copy namespace. */
    const NS = "blenderAnnotate";
    /** Renderer identity: the registry definition id and the body slot key. */
    const BODY_ID = "dsh-blender-annotate/scene";
    /** Route that converts and serves the scene; the Host half owns the same default. */
    const DEFAULT_ROUTE_PATH = "/api/blender-annotate";
    /** Suffixes mirrored from the Host defaults. */
    const DEFAULT_EXTENSIONS = ["blend"];

    const zh = {
      blender: "Blender",
      loading: "正在用 Blender 导出预览…",
      loadingHint: "首次打开需要几秒，之后直接读缓存。",
      preparing: "正在读取场景信息…",
      elapsed: "已用 {seconds}s",
      failed: "无法预览这个场景",
      retry: "重试",
      reset: "重置视角",
      wireframe: "线框",
      spin: "自动旋转",
      info: "场景信息",
      hint: "拖动旋转 · 滚轮缩放 · 双击复位",
      size: "外形尺寸",
      objects: "对象",
      triangles: "三角面",
      materials: "材质",
      cameras: "相机",
      lights: "灯光",
      exportMeta: "{blender} · {size} GLB · {time}",
      cached: "缓存命中",
      exportedIn: "导出 {seconds}s",
      unit: "单位",
      scene: "场景",
      collections: "集合",
      noSceneInfo: "没有可显示的场景信息。",
      details: "Blender 日志",
      webglMissing: "这个浏览器/显卡组合不支持 WebGL，无法绘制 3D 预览。",
      readFailed: "无法读取这个文件。",
      unsupported: "这个文件无法被 Blender 打开，或者不是有效的 .blend。",
      annotate: "标注",
      annotations: "标注",
      sketch: "草图",
      send: "发送到对话",
      targetPoint: "点",
      targetFace: "面",
      targetEdge: "边",
      targetVertex: "顶点",
      targetObject: "对象",
      annotateHint: "点击模型放置标注 · 拖动仍可旋转",
      commentPlaceholder: "写下对这个位置的意见…",
      save: "保存",
      cancel: "取消",
      goTo: "定位",
      remove: "删除",
      parameters: "详细参数",
      noAnnotations: "还没有标注。打开「标注」后点击模型。",
      noHit: "没有点中模型表面",
      sent: "已把标注写入输入框",
      sentNoSnapshot: "标注已写入输入框，但截图附加失败",
      saveFirst: "请先保存或取消当前标注",
      sketchAdded: "已把草图插入输入框",
      sendFailed: "无法写入输入框",
      stale: "文件已变更",
      precisionExact: "精确",
      precisionModified: "修改器改变了表面",
      precisionCopy: "修改器生成的副本",
      precisionObject: "仅对象",
      box: "方框",
      ellipse: "圆形",
      arrow: "箭头",
      text: "文字",
      undo: "撤销",
      clear: "清空",
      insert: "插入输入框",
      textPrompt: "输入要标注的文字",
      editor: "标注后插入",
      messageTitle: "3D 标注",
    };

    const en = {
      blender: "Blender",
      loading: "Exporting the preview with Blender…",
      loadingHint: "The first open takes a few seconds; later opens read the cache.",
      preparing: "Reading scene information…",
      elapsed: "{seconds}s elapsed",
      failed: "This scene could not be previewed",
      retry: "Retry",
      reset: "Reset view",
      wireframe: "Wireframe",
      spin: "Auto-rotate",
      info: "Scene info",
      hint: "Drag to orbit · Wheel to zoom · Double-click to reset",
      size: "Size",
      objects: "Objects",
      triangles: "Triangles",
      materials: "Materials",
      cameras: "Cameras",
      lights: "Lights",
      exportMeta: "{blender} · {size} GLB · {time}",
      cached: "cache hit",
      exportedIn: "exported in {seconds}s",
      unit: "Unit",
      scene: "Scene",
      collections: "Collections",
      noSceneInfo: "No scene information to show.",
      details: "Blender log",
      webglMissing: "This browser/GPU combination does not support WebGL, so the 3D preview cannot be drawn.",
      readFailed: "This file could not be read.",
      unsupported: "Blender could not open this file, or it is not a valid .blend.",
      annotate: "Annotate",
      annotations: "Annotations",
      sketch: "Sketch",
      send: "Send to chat",
      targetPoint: "Point",
      targetFace: "Face",
      targetEdge: "Edge",
      targetVertex: "Vertex",
      targetObject: "Object",
      annotateHint: "Click the model to annotate · drag still orbits",
      commentPlaceholder: "What should change here?",
      save: "Save",
      cancel: "Cancel",
      goTo: "Go to",
      remove: "Delete",
      parameters: "Parameters",
      noAnnotations: "No annotations yet. Turn on Annotate, then click the model.",
      noHit: "That click did not land on the model",
      sent: "Annotations added to the composer",
      sentNoSnapshot: "Annotations added, but the snapshot could not be attached",
      saveFirst: "Save or cancel the current annotation first",
      sketchAdded: "Sketch added to the composer",
      sendFailed: "Could not write to the composer",
      stale: "file changed",
      precisionExact: "exact",
      precisionModified: "surface changed by a modifier",
      precisionCopy: "modifier-generated copy",
      precisionObject: "object only",
      box: "Box",
      ellipse: "Circle",
      arrow: "Arrow",
      text: "Text",
      undo: "Undo",
      clear: "Clear",
      insert: "Insert",
      textPrompt: "Text to annotate",
      editor: "Annotate the view, then insert it",
      messageTitle: "3D annotations",
    };

    /** Scoped styles; every selector starts at the root attribute. */
    const STYLE = [
      '[data-blender-annotate]{display:flex;flex-direction:column;flex:auto;height:100%;min-height:0;box-sizing:border-box;color:var(--dsw-alias-label-primary,#1f2329);font-size:12px}',
      '[data-blender-annotate] .dsh-bp-toolbar{display:flex;align-items:center;gap:6px;flex:none;padding:7px 10px;border-bottom:1px solid var(--dsw-alias-border-l1,rgba(0,0,0,.1))}',
      '[data-blender-annotate] .dsh-bp-name{font-weight:600;font-size:12px;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '[data-blender-annotate] .dsh-bp-actions{display:flex;gap:4px;margin-left:auto;flex:none}',
      '[data-blender-annotate] .dsh-bp-button{appearance:none;border:0;border-radius:7px;padding:5px 8px;font:inherit;font-size:11px;line-height:1.2;cursor:pointer;color:var(--dsw-alias-label-primary,#1f2329);background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.06));white-space:nowrap}',
      '[data-blender-annotate] .dsh-bp-button:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.12))}',
      '[data-blender-annotate] .dsh-bp-button[data-active="true"]{background:var(--dsw-alias-interactive-bg-selected,rgba(64,128,255,.18));color:var(--dsw-alias-label-accent,#2c6ef2)}',
      '[data-blender-annotate] .dsh-bp-viewport{position:relative;flex:1 1 auto;min-height:240px;min-width:0;overflow:hidden;background:radial-gradient(120% 100% at 50% 0%,#2a3446 0%,#141a24 55%,#0b0f16 100%)}',
      '[data-blender-annotate] .dsh-bp-canvas{position:absolute;inset:0;display:block;width:100%;height:100%;touch-action:none;cursor:grab;outline:none}',
      '[data-blender-annotate] .dsh-bp-canvas:active{cursor:grabbing}',
      '[data-blender-annotate] .dsh-bp-badge{position:absolute;left:10px;top:10px;padding:4px 8px;border-radius:999px;background:rgba(9,13,20,.55);color:#dfe8f6;font-size:11px;letter-spacing:.01em;pointer-events:none;backdrop-filter:blur(6px)}',
      '[data-blender-annotate] .dsh-bp-hint{position:absolute;left:10px;bottom:8px;color:rgba(223,232,246,.55);font-size:10.5px;pointer-events:none;user-select:none}',
      '[data-blender-annotate] .dsh-bp-overlay{position:absolute;inset:0;display:grid;place-items:center;padding:20px;background:rgba(8,11,17,.72);backdrop-filter:blur(3px)}',
      '[data-blender-annotate] .dsh-bp-card{width:min(420px,100%);color:#e8edf5;text-align:center;display:flex;flex-direction:column;gap:10px;align-items:center}',
      '[data-blender-annotate] .dsh-bp-card[data-tone="error"]{text-align:left;align-items:stretch}',
      '[data-blender-annotate] .dsh-bp-title{margin:0;font-size:13px;font-weight:600}',
      '[data-blender-annotate] .dsh-bp-text{margin:0;font-size:11.5px;line-height:1.55;color:rgba(232,237,245,.72)}',
      '[data-blender-annotate] .dsh-bp-code{margin:0;font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:10.5px;color:#ffb4b4}',
      '[data-blender-annotate] .dsh-bp-spinner{width:22px;height:22px;border-radius:50%;border:2px solid rgba(255,255,255,.2);border-top-color:#7fa8ff;animation:dsh-bp-spin .8s linear infinite}',
      '@keyframes dsh-bp-spin{to{transform:rotate(360deg)}}',
      '[data-blender-annotate] .dsh-bp-panel{flex:none;max-height:40%;overflow:auto;padding:10px 12px;border-top:1px solid var(--dsw-alias-border-l1,rgba(0,0,0,.1));background:var(--dsw-alias-bg-layer-2,rgba(0,0,0,.02))}',
      '[data-blender-annotate] .dsh-bp-panel[data-open="false"]{display:none}',
      '[data-blender-annotate] .dsh-bp-summary{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:4px 14px;margin-bottom:8px}',
      '[data-blender-annotate] .dsh-bp-kv{display:flex;justify-content:space-between;gap:8px;min-width:0}',
      '[data-blender-annotate] .dsh-bp-kv span:first-child{opacity:.6}',
      '[data-blender-annotate] .dsh-bp-kv span:last-child{font-variant-numeric:tabular-nums;text-align:right;overflow-wrap:anywhere}',
      '[data-blender-annotate] .dsh-bp-table{width:100%;border-collapse:collapse;font-size:11.5px}',
      '[data-blender-annotate] .dsh-bp-table th{text-align:left;font-weight:500;opacity:.5;padding:2px 4px;border-bottom:1px solid var(--dsw-alias-border-l1,rgba(0,0,0,.08))}',
      '[data-blender-annotate] .dsh-bp-table td{padding:3px 4px;border-bottom:1px solid var(--dsw-alias-border-l1,rgba(0,0,0,.05));vertical-align:top}',
      '[data-blender-annotate] .dsh-bp-table td.num{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}',
      '[data-blender-annotate] .dsh-bp-swatch{display:inline-block;width:9px;height:9px;border-radius:3px;margin-right:6px;vertical-align:-1px;box-shadow:inset 0 0 0 1px rgba(0,0,0,.18)}',
      '[data-blender-annotate] .dsh-bp-materials{display:flex;flex-wrap:wrap;gap:5px;margin-top:6px}',
      '[data-blender-annotate] .dsh-bp-chip{display:inline-flex;align-items:center;gap:5px;padding:2px 7px;border-radius:999px;background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.05));font-size:10.5px}',
      '[data-blender-annotate] .dsh-bp-footer{margin-top:8px;font-size:10.5px;opacity:.55;display:flex;flex-wrap:wrap;gap:4px 10px}',
      '[data-blender-annotate] .dsh-bp-details{margin-top:4px;font-size:10.5px;color:rgba(232,237,245,.7)}',
      '[data-blender-annotate] .dsh-bp-details pre{max-height:180px;overflow:auto;white-space:pre-wrap;word-break:break-word;background:rgba(0,0,0,.25);padding:8px;border-radius:8px;margin:6px 0 0;font-size:10.5px}',
      // dsh-blender-annotate
      '[data-blender-annotate] .dsh-bp-toolbar{flex-wrap:wrap}',
      '[data-blender-annotate] .dsh-bp-actions{flex-wrap:wrap;justify-content:flex-end}',
      '[data-blender-annotate] .dsh-ba-targets{display:flex;flex-wrap:wrap;gap:2px;flex:1 0 100%;padding-top:4px}',
      '[data-blender-annotate] .dsh-ba-targets .dsh-bp-button{padding:3px 8px}',
      '[data-blender-annotate] .dsh-bp-canvas[data-annotating="true"]{cursor:crosshair}',
      '[data-blender-annotate] .dsh-ba-pins{position:absolute;inset:0;pointer-events:none;overflow:hidden}',
      '[data-blender-annotate] .dsh-ba-pin{position:absolute;left:0;top:0;width:20px;height:20px;margin:-10px 0 0 -10px;border-radius:50%;display:grid;place-items:center;font-size:10.5px;font-weight:700;color:#1b1300;background:#ffb020;box-shadow:0 0 0 2px #fff,0 2px 6px rgba(0,0,0,.45);pointer-events:auto;cursor:pointer;user-select:none;will-change:transform}',
      '[data-blender-annotate] .dsh-ba-pin[data-draft="true"]{background:#4f8cff;color:#fff}',
      '[data-blender-annotate] .dsh-ba-pin[data-occluded="true"]{opacity:.35}',
      '[data-blender-annotate] .dsh-ba-pin[data-offscreen="true"]{display:none}',
      '[data-blender-annotate] .dsh-ba-draft{position:absolute;left:8px;right:8px;bottom:8px;display:flex;flex-direction:column;gap:6px;padding:9px 10px;border-radius:10px;background:var(--dsw-alias-bg-layer-2,#fff);color:var(--dsw-alias-label-primary,#1f2329);box-shadow:0 8px 28px rgba(0,0,0,.35);max-height:62%;overflow:auto}',
      '[data-blender-annotate] .dsh-ba-selector{font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:11px;line-height:1.45;overflow-wrap:anywhere}',
      '[data-blender-annotate] .dsh-ba-meta{font-size:10.5px;opacity:.65}',
      '[data-blender-annotate] .dsh-ba-draft textarea{width:100%;box-sizing:border-box;min-height:52px;resize:vertical;border:1px solid var(--dsw-alias-border-default,rgba(0,0,0,.18));border-radius:7px;padding:6px 8px;font:inherit;font-size:12px;background:transparent;color:inherit}',
      '[data-blender-annotate] .dsh-ba-row{display:flex;gap:6px;align-items:center;justify-content:flex-end;flex-wrap:wrap}',
      '[data-blender-annotate] .dsh-ba-details summary{cursor:pointer;font-size:11px;opacity:.75}',
      '[data-blender-annotate] .dsh-ba-details pre{margin:4px 0 0;white-space:pre-wrap;overflow-wrap:anywhere;font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:10.5px;line-height:1.45;opacity:.85}',
      '[data-blender-annotate] .dsh-ba-tabs{display:flex;gap:4px;margin-bottom:8px}',
      '[data-blender-annotate] .dsh-ba-list{display:flex;flex-direction:column;gap:6px}',
      '[data-blender-annotate] .dsh-ba-item{display:grid;grid-template-columns:22px 1fr auto;gap:6px 8px;align-items:start;padding:6px 0;border-bottom:1px solid var(--dsw-alias-border-l1,rgba(0,0,0,.06))}',
      '[data-blender-annotate] .dsh-ba-item .dsh-ba-num{width:20px;height:20px;border-radius:50%;display:grid;place-items:center;font-size:10.5px;font-weight:700;color:#1b1300;background:#ffb020}',
      '[data-blender-annotate] .dsh-ba-item p{margin:2px 0 0;font-size:12px;overflow-wrap:anywhere}',
      '[data-blender-annotate] .dsh-ba-notice{position:absolute;left:50%;top:10px;transform:translateX(-50%);padding:4px 10px;border-radius:999px;background:rgba(9,13,20,.75);color:#dfe8f6;font-size:11px;pointer-events:none;white-space:nowrap}',
      '[data-ba-editor]{position:fixed;inset:0;z-index:100001;background:rgba(8,10,14,.72);display:flex;align-items:center;justify-content:center;padding:24px;box-sizing:border-box}',
      '[data-ba-editor] .ba-editor-panel{display:flex;flex-direction:column;gap:10px;max-width:94vw;max-height:92vh;background:var(--dsw-alias-bg-layer-2,#fff);color:var(--dsw-alias-label-primary,#1f2329);border-radius:12px;padding:12px;box-shadow:0 18px 60px rgba(0,0,0,.35)}',
      '[data-ba-editor] .ba-editor-toolbar{display:flex;gap:6px;align-items:center;flex-wrap:wrap}',
      '[data-ba-editor] .ba-editor-toolbar button,[data-ba-editor] .ba-editor-textbar button{appearance:none;border:1px solid rgba(0,0,0,.12);border-radius:7px;padding:5px 9px;font:inherit;font-size:12px;cursor:pointer;background:transparent;color:inherit}',
      '[data-ba-editor] .ba-editor-toolbar button[data-active=true]{background:#2c6ef2;color:#fff;border-color:#2c6ef2}',
      '[data-ba-editor] .ba-editor-toolbar button[data-color]{width:22px;height:22px;padding:0;border-radius:999px}',
      '[data-ba-editor] .ba-editor-toolbar button[data-color][data-active=true]{outline:2px solid #111;outline-offset:2px}',
      '[data-ba-editor] .ba-editor-spacer{flex:1 1 auto}',
      '[data-ba-editor] .ba-editor-textbar{display:flex;gap:6px;align-items:center}',
      '[data-ba-editor] .ba-editor-textbar input{flex:1 1 auto;min-width:180px;border:1px solid rgba(0,0,0,.18);border-radius:7px;padding:6px 8px;font:inherit;font-size:12px;background:transparent;color:inherit}',
      '[data-ba-editor] canvas{display:block;max-width:90vw;max-height:72vh;width:auto;height:auto;background:#fff;border-radius:8px;cursor:crosshair;touch-action:none}',
      '[data-ba-editor] .ba-editor-hint{font-size:11px;opacity:.55}',
    ].join("\n");

    /** Install the scoped stylesheet once per document. */
    function installStyle() {
      if (typeof document === "undefined") return;
      const tagId = "dsh-blender-annotate/client.css";
      if (document.querySelector('style[data-plugin-css="' + tagId + '"]') !== null) return;
      const tag = document.createElement("style");
      tag.dataset.plugin = "dsh-blender-annotate";
      tag.dataset.pluginCss = tagId;
      tag.textContent = STYLE;
      document.head.appendChild(tag);
    }

    /** Fill `{key}` placeholders. */
    function fill(template, values) {
      return String(template).replace(/\{(\w+)\}/g, (whole, key) =>
        Object.prototype.hasOwnProperty.call(values, key) ? String(values[key]) : whole
      );
    }

    /** A final path segment. */
    function basenameOf(path) {
      if (typeof path !== "string") return "";
      const normalized = path.replaceAll("\\", "/");
      return normalized.slice(normalized.lastIndexOf("/") + 1);
    }

    /** Human byte size, or the empty string when unknown. */
    function formatBytes(bytes) {
      if (typeof bytes !== "number" || !Number.isFinite(bytes) || bytes < 0) return "";
      const units = ["B", "KB", "MB", "GB", "TB"];
      let value = bytes;
      let unit = 0;
      while (value >= 1024 && unit < units.length - 1) {
        value /= 1024;
        unit += 1;
      }
      const rounded = unit === 0 ? String(Math.round(value)) : value.toFixed(value >= 100 ? 0 : 1);
      return rounded + " " + units[unit];
    }

    /** Thousands separators without depending on the UI locale. */
    function formatCount(value) {
      if (typeof value !== "number" || !Number.isFinite(value)) return "0";
      return String(Math.round(value)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    }

    /** One dimension triple in millimetres. */
    function formatSize(values) {
      if (!Array.isArray(values) || values.length < 3) return "—";
      return values
        .slice(0, 3)
        .map((value) => (typeof value === "number" && Number.isFinite(value) ? String(Math.round(value * 10) / 10) : "0"))
        .join(" × ") + " mm";
    }

    /** The route the Host half actually registered, as injected at boot. */
    function configuredConfig() {
      const config = globalThis.__DSH_BLENDER_ANNOTATE_CONFIG__;
      const routePath =
        typeof config === "object" && config !== null && typeof config.routePath === "string" && config.routePath !== ""
          ? config.routePath
          : DEFAULT_ROUTE_PATH;
      const extensions =
        typeof config === "object" && config !== null && Array.isArray(config.extensions) && config.extensions.length > 0
          ? config.extensions.filter((entry) => typeof entry === "string" && entry !== "")
          : DEFAULT_EXTENSIONS;
      return { routePath, extensions };
    }

    /** The route URL for one artifact of one file version. */
    function assetUrl(routePath, absolutePath, kind, version) {
      return (
        routePath +
        "?path=" +
        encodeURIComponent(absolutePath) +
        "&kind=" +
        encodeURIComponent(kind) +
        "&v=" +
        encodeURIComponent(version)
      );
    }

    /** The material swatch for one scene object. */
    function swatchFor(object, materials) {
      const names = Array.isArray(object.materials) ? object.materials.filter(Boolean) : [];
      for (const name of names) {
        const material = materials.find((entry) => entry.name === name);
        if (material && typeof material.hex === "string") return material.hex;
      }
      return "#8a94a6";
    }

    // ------------------------------------------------------------ annotations
    const TARGETS = ["point", "face", "edge", "vertex", "object"];
    const TARGET_LABEL = { point: "targetPoint", face: "targetFace", edge: "targetEdge", vertex: "targetVertex", object: "targetObject" };
    const PRECISION_LABEL = { exact: "precisionExact", "modified-surface": "precisionModified", "modifier-copy": "precisionCopy", object: "precisionObject", face: "precisionObject" };
    const SKETCH_COLORS = ["#e11d48", "#f59e0b", "#2563eb", "#16a34a"];
    const STORE_PREFIX = "dsh-blender-annotate:v1:";

    function loadAnnotations(path) {
      try {
        const raw = window.localStorage.getItem(STORE_PREFIX + path);
        const parsed = raw ? JSON.parse(raw) : null;
        return parsed && Array.isArray(parsed.items) ? parsed : { version: null, items: [] };
      } catch {
        return { version: null, items: [] };
      }
    }
    function storeAnnotations(path, version, items) {
      try {
        if (items.length === 0) window.localStorage.removeItem(STORE_PREFIX + path);
        else window.localStorage.setItem(STORE_PREFIX + path, JSON.stringify({ version, items }));
      } catch {
        // Storage full or blocked: annotations stay in memory for this view.
      }
    }

    /**
     * Blender's exact world matrix for a node, converted to glTF space, or null.
     * Used only for a uniquely named, non-instanced object whose exported origin
     * agrees with Blender's, so an instanced copy that shares a name is never moved.
     */
    function exactWorldFor(annotate) {
      if (!annotate || !annotate.objects) return null;
      const objects = annotate.objects;
      const byName = {};
      for (const key of Object.keys(objects)) (byName[objects[key].name || key] ||= []).push(key);
      const C = [1, 0, 0, 0, 0, 0, -1, 0, 0, 1, 0, 0, 0, 0, 0, 1];
      const Cinv = [1, 0, 0, 0, 0, 0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 1];
      return (name, ancestors, computed) => {
        const keys = byName[name];
        if (!keys || keys.length !== 1) return null;
        if (ancestors.includes(name)) return null; // geometry-nodes instance named after its owner
        for (const ancestor of ancestors) {
          const owner = byName[ancestor];
          if (owner && owner.some((key) => objects[key].instance_collection)) return null;
        }
        const exact = m4mul(m4mul(C, rowsToColumnMajor(objects[keys[0]].matrix_world)), Cinv);
        const dx = exact[12] - computed[12], dy = exact[13] - computed[13], dz = exact[14] - computed[14];
        const scale = 1 + Math.hypot(exact[12], exact[13], exact[14]);
        return Math.hypot(dx, dy, dz) <= 1e-4 * scale ? exact : null;
      };
    }

    /** Overlay geometry (glTF world) emphasising an annotation's target. */
    function overlayFor(viewer, item) {
      if (viewer === null || !item || !item.hit || item.stale) return null;
      const r = item.resolved;
      const hit = item.hit;
      const outline = (points) => {
        const lines = [];
        for (let i = 0; i < points.length; i += 1) lines.push(...points[i], ...points[(i + 1) % points.length]);
        return lines;
      };
      if (item.target === "object") return { faces: viewer.trianglesOf(hit.nodeIndex, 0, null) };
      const faces = r && r.face !== null ? viewer.trianglesOf(hit.nodeIndex, hit.srcId, hit.faceId) : null;
      if (item.target === "face") return { faces, lines: r && r.snap ? outline(r.snap.faceOutline) : null };
      if (item.target === "edge" && r && r.snap) {
        return { faces, faceColor: [1, 0.72, 0.18, 0.14], lines: [...r.snap.edgeEnds[0], ...r.snap.edgeEnds[1]], lineColor: [1, 0.3, 0.3, 1] };
      }
      if (item.target === "vertex" && r && r.snap) {
        const p = r.snap.vertexPoint;
        const edge = r.snap.faceOutline;
        let size = 0.02;
        if (edge && edge.length > 1) size = Math.hypot(edge[0][0] - edge[1][0], edge[0][1] - edge[1][1], edge[0][2] - edge[1][2]) * 0.12;
        const lines = [];
        for (let a = 0; a < 3; a += 1) {
          const lo = p.slice(), hi = p.slice();
          lo[a] -= size; hi[a] += size;
          lines.push(...lo, ...hi);
        }
        return { faces, faceColor: [1, 0.72, 0.18, 0.14], lines, lineColor: [1, 0.3, 0.3, 1] };
      }
      return { faces, faceColor: [1, 0.72, 0.18, 0.22] };
    }

    /** The current 3D view with numbered pins burnt in, as a 2D canvas. */
    function snapshotWithPins(viewer, items) {
      const source = viewer.canvas;
      const out = document.createElement("canvas");
      out.width = source.width;
      out.height = source.height;
      const context = out.getContext("2d");
      if (context === null) throw new Error("canvas");
      const background = context.createLinearGradient(0, 0, 0, out.height);
      background.addColorStop(0, "#2a3446");
      background.addColorStop(1, "#0b0f16");
      context.fillStyle = background;
      context.fillRect(0, 0, out.width, out.height);
      context.drawImage(source, 0, 0);
      const rect = source.getBoundingClientRect();
      const scale = out.width / Math.max(rect.width, 1);
      const radius = 11 * scale;
      items.forEach((item, index) => {
        const at = viewer.project(item.anchor);
        if (!at.visible || item.stale) return;
        const x = at.x * scale, y = at.y * scale;
        context.beginPath();
        context.arc(x, y, radius, 0, Math.PI * 2);
        context.fillStyle = "#ffb020";
        context.fill();
        context.lineWidth = 2 * scale;
        context.strokeStyle = "#ffffff";
        context.stroke();
        context.fillStyle = "#1b1300";
        context.font = `700 ${Math.round(11 * scale)}px sans-serif`;
        context.textAlign = "center";
        context.textBaseline = "middle";
        context.fillText(String(index + 1), x, y + 0.5);
      });
      return out;
    }

    function canvasToFile(canvas, stem) {
      return new Promise((resolve, reject) => {
        canvas.toBlob((blob) => {
          if (blob === null) reject(new Error("encode"));
          else resolve(new File([blob], `${stem}-${Date.now()}.png`, { type: "image/png" }));
        }, "image/png");
      });
    }

    function payloadUnit(item) {
      const unit = item.source && item.source.mmPerUnit;
      return typeof unit === "number" && unit > 0 ? unit : 1000;
    }

    /** Markdown the agent receives: one block per annotation, numbered like the pins. */
    function buildMessage(t, fileName, filePath, items) {
      const lines = [`### ${t("messageTitle")} — \`${fileName}\``, `File: \`${filePath}\``, ""];
      items.forEach((item, index) => {
        lines.push(`**${index + 1}. ${item.comment.trim() || "(no comment)"}**`);
        lines.push(item.resolved ? describeResolved(item.resolved, item.target) : `- target: ${item.target}`);
        if (item.source) {
          lines.push(`- source revision: ${JSON.stringify(item.source.version)} · export cache key: ${item.source.cacheKey || "unavailable"}`);
        }
        if (item.stale) lines.push("- note: recorded on an earlier version of this file; do not use its indices on the current geometry without revalidation");
        const r = item.resolved;
        const anchorWorldMm = r && item.anchor ? v3scale(yupToZup(item.anchor), payloadUnit(item)) : null;
        if (anchorWorldMm && (item.target === "edge" || item.target === "vertex")) {
          lines.push(`- snapped target point (world): ${fmtVec(anchorWorldMm, 6)} mm; point/UV/face parameters above describe the original surface click`);
        }
        const reference = {
          schema: "dsh.blender.annotation.v1",
          id: item.id,
          source: item.source || { path: filePath, version: null },
          target: item.target,
          comment: item.comment,
          stale: Boolean(item.stale),
          object: r ? { name: r.object, key: r.objectKey, library: r.library, instancer: r.instancer } : null,
          sourceElement: r ? { mesh: r.mesh, face: r.face, sourceObject: r.sourceObject, sourceLibrary: r.sourceLibrary, edge: item.target === "edge" ? r.edge : null, vertex: item.target === "vertex" ? r.vertex : null, provenance: r.precision } : null,
          surface: r ? r.evaluated : null,
          pickedPoint: r ? { localMm: r.localMm, worldMm: r.worldMm, normal: r.normal, uv: r.uv, sourceFaceParameters: r.params } : null,
          targetPointWorldMm: anchorWorldMm,
          view: item.view,
        };
        lines.push("```json", JSON.stringify(reference), "```", "");
      });
      return lines.join("\n");
    }

    function drawSketchShape(context, shape, lineWidth, font) {
      context.save();
      context.strokeStyle = shape.color;
      context.fillStyle = shape.color;
      context.lineWidth = lineWidth;
      context.lineCap = "round";
      context.lineJoin = "round";
      const x = Math.min(shape.x1, shape.x2);
      const y = Math.min(shape.y1, shape.y2);
      const w = Math.abs(shape.x2 - shape.x1);
      const h = Math.abs(shape.y2 - shape.y1);
      if (shape.type === "rect") {
        context.strokeRect(x, y, w, h);
      } else if (shape.type === "ellipse") {
        context.beginPath();
        context.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
        context.stroke();
      } else if (shape.type === "arrow") {
        context.beginPath();
        context.moveTo(shape.x1, shape.y1);
        context.lineTo(shape.x2, shape.y2);
        context.stroke();
        const angle = Math.atan2(shape.y2 - shape.y1, shape.x2 - shape.x1);
        const head = Math.max(10, lineWidth * 3);
        context.beginPath();
        context.moveTo(shape.x2, shape.y2);
        context.lineTo(shape.x2 - head * Math.cos(angle - 0.5), shape.y2 - head * Math.sin(angle - 0.5));
        context.moveTo(shape.x2, shape.y2);
        context.lineTo(shape.x2 - head * Math.cos(angle + 0.5), shape.y2 - head * Math.sin(angle + 0.5));
        context.stroke();
      } else if (shape.type === "text") {
        context.font = `600 ${font}px sans-serif`;
        context.textBaseline = "top";
        context.fillText(shape.text, shape.x1, shape.y1);
      }
      context.restore();
    }

    /** Free-form markup over the captured view (adapted from dsh-preview-snip's SnipEditor, MIT). */
    function SketchEditor({ src, width, height, t, onCancel, onCommit }) {
      const canvasRef = React.useRef(null);
      const imageRef = React.useRef(null);
      const startRef = React.useRef(null);
      const [tool, setTool] = React.useState("ellipse");
      const [color, setColor] = React.useState(SKETCH_COLORS[0]);
      const [shapes, setShapes] = React.useState([]);
      const [draft, setDraft] = React.useState(null);
      const [textAt, setTextAt] = React.useState(null);
      const [textValue, setTextValue] = React.useState("");
      const [busy, setBusy] = React.useState(false);

      const redraw = React.useCallback(() => {
        const canvas = canvasRef.current;
        const image = imageRef.current;
        if (canvas === null || image === null) return;
        const context = canvas.getContext("2d");
        if (context === null) return;
        context.clearRect(0, 0, canvas.width, canvas.height);
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        const lineWidth = Math.max(4, canvas.width / 260);
        const font = Math.max(22, canvas.width / 28);
        for (const shape of shapes) drawSketchShape(context, shape, lineWidth, font);
        if (draft !== null) drawSketchShape(context, draft, lineWidth, font);
      }, [shapes, draft]);

      React.useEffect(() => {
        const image = new Image();
        image.onload = () => {
          imageRef.current = image;
          const canvas = canvasRef.current;
          if (canvas !== null) {
            canvas.width = width;
            canvas.height = height;
            redraw();
          }
        };
        image.src = src;
      }, [src, width, height, redraw]);
      React.useEffect(() => { redraw(); }, [redraw]);

      const pointOf = (event) => {
        const canvas = canvasRef.current;
        if (canvas === null) return { x: 0, y: 0 };
        const rect = canvas.getBoundingClientRect();
        return { x: ((event.clientX - rect.left) / rect.width) * canvas.width, y: ((event.clientY - rect.top) / rect.height) * canvas.height };
      };
      const onPointerDown = (event) => {
        event.preventDefault();
        const point = pointOf(event);
        if (tool === "text") { setTextAt(point); setTextValue(""); return; }
        startRef.current = point;
        setDraft({ type: tool, x1: point.x, y1: point.y, x2: point.x, y2: point.y, color });
        event.currentTarget.setPointerCapture?.(event.pointerId);
      };
      const onPointerMove = (event) => {
        if (startRef.current === null) return;
        const point = pointOf(event);
        setDraft((previous) => (previous === null ? null : { ...previous, x2: point.x, y2: point.y }));
      };
      const onPointerUp = () => {
        if (startRef.current === null) return;
        startRef.current = null;
        setDraft((previous) => {
          if (previous !== null) {
            const dx = Math.abs(previous.x2 - previous.x1), dy = Math.abs(previous.y2 - previous.y1);
            const drawable = previous.type === "arrow" ? Math.hypot(dx, dy) > 2 : dx > 2 && dy > 2;
            if (drawable) setShapes((now) => [...now, previous]);
          }
          return null;
        });
      };
      const addText = () => {
        if (textAt === null || textValue.trim() === "") return;
        setShapes((previous) => [...previous, { type: "text", x1: textAt.x, y1: textAt.y, x2: textAt.x, y2: textAt.y, text: textValue, color }]);
        setTextAt(null);
        setTextValue("");
      };
      const insert = async () => {
        const canvas = canvasRef.current;
        if (canvas === null) return;
        setBusy(true);
        try { await onCommit(await canvasToFile(canvas, "blender-sketch")); } finally { setBusy(false); }
      };
      const toolButton = (id, label) =>
        React.createElement("button", { type: "button", key: id, "data-active": tool === id, onClick: () => setTool(id) }, t(label));

      return React.createElement(
        "div",
        { "data-ba-editor": true },
        React.createElement(
          "div",
          { className: "ba-editor-panel" },
          React.createElement(
            "div",
            { className: "ba-editor-toolbar" },
            toolButton("rect", "box"),
            toolButton("ellipse", "ellipse"),
            toolButton("arrow", "arrow"),
            toolButton("text", "text"),
            ...SKETCH_COLORS.map((value) =>
              React.createElement("button", { key: value, type: "button", "data-color": true, "data-active": color === value, title: value, style: { background: value }, onClick: () => setColor(value) })
            ),
            React.createElement("span", { className: "ba-editor-spacer" }),
            React.createElement("button", { type: "button", onClick: () => setShapes((previous) => previous.slice(0, -1)) }, t("undo")),
            React.createElement("button", { type: "button", onClick: () => setShapes([]) }, t("clear")),
            React.createElement("button", { type: "button", onClick: onCancel }, t("cancel")),
            React.createElement("button", { type: "button", disabled: busy, onClick: () => void insert() }, busy ? "…" : t("insert"))
          ),
          textAt === null
            ? null
            : React.createElement(
                "div",
                { className: "ba-editor-textbar" },
                React.createElement("input", {
                  autoFocus: true,
                  value: textValue,
                  placeholder: t("textPrompt"),
                  onChange: (event) => setTextValue(event.target.value),
                  onKeyDown: (event) => { if (event.key === "Enter") addText(); if (event.key === "Escape") setTextAt(null); },
                }),
                React.createElement("button", { type: "button", onClick: addText }, t("insert")),
                React.createElement("button", { type: "button", onClick: () => setTextAt(null) }, t("cancel"))
              ),
          React.createElement("canvas", { ref: canvasRef, width, height, onPointerDown, onPointerMove, onPointerUp }),
          React.createElement("p", { className: "ba-editor-hint" }, t("editor"))
        )
      );
    }

    /**
     * The preview body: fetch the scene JSON and the exported GLB, draw the
     * model, and show the scene facts underneath.
     * @param props - document body props plus the injected route and copy.
     * @returns the preview, or its loading/error state.
     */
    function BlendBody(props) {
      const { content, resourceAddress, useResource, t, routePath, inputActions, useInput, sessionId, createDraftsFor } = props;
      const composerDraft = typeof useInput === "function" ? useInput((input) => input.draft) : "";
      const meta = useResource(resourceAddress);
      const absolutePath = meta.value && meta.value.absolutePath ? meta.value.absolutePath : undefined;
      const version = meta.value && meta.value.version ? meta.value.version : "0";
      const revision = content !== undefined && content.kind === "renderer" ? content.revision : 0;
      const tRef = React.useRef(t);
      tRef.current = t;

      const viewerRef = React.useRef(null);
      const viewerErrorRef = React.useRef("");
      const [viewerError, setViewerError] = React.useState("");
      const [state, setState] = React.useState("loading");
      const [payload, setPayload] = React.useState(null);
      const [stats, setStats] = React.useState(null);
      const [failure, setFailure] = React.useState(null);
      const [attempt, setAttempt] = React.useState(0);
      const [elapsed, setElapsed] = React.useState(0);
      const [panelOpen, setPanelOpen] = React.useState(true);
      const [wireframe, setWireframe] = React.useState(false);
      const [autoRotate, setAutoRotate] = React.useState(false);
      const reported = React.useRef(-1);

      // Annotation state.
      const [annotating, setAnnotating] = React.useState(false);
      const [target, setTarget] = React.useState("point");
      const [annotations, setAnnotations] = React.useState([]);
      const [draft, setDraft] = React.useState(null);
      const [selectedId, setSelectedId] = React.useState(null);
      const [panelTab, setPanelTab] = React.useState("info");
      const [notice, setNotice] = React.useState("");
      const [sketch, setSketch] = React.useState(null);
      const resolverRef = React.useRef(null);
      const loadedRef = React.useRef(false);
      const loadedVersionRef = React.useRef(null);
      const loadedPathRef = React.useRef(null);
      const pinElements = React.useRef({});
      const pinItemsRef = React.useRef([]);
      const occlusionAt = React.useRef(0);
      const clickRef = React.useRef(() => {});
      const viewRef = React.useRef(() => {});
      const noticeTimer = React.useRef(0);

      const flash = React.useCallback((message) => {
        setNotice(message);
        clearTimeout(noticeTimer.current);
        noticeTimer.current = setTimeout(() => setNotice(""), 2600);
      }, []);
      React.useEffect(() => () => clearTimeout(noticeTimer.current), []);

      const anchorFor = (item, nextTarget) => {
        const r = item.resolved;
        if (nextTarget === "edge" && r && r.snap) return r.snap.edgePoint;
        if (nextTarget === "vertex" && r && r.snap) return r.snap.vertexPoint;
        return item.hit.point;
      };

      // Click on the model (no drag) while annotating: resolve and open a draft.
      clickRef.current = (clientX, clientY) => {
        const viewer = viewerRef.current;
        if (!annotating || viewer === null || state !== "ready") return;
        if (draft !== null && draft.comment.trim() !== "") {
          flash(t("saveFirst"));
          return;
        }
        const hit = viewer.pick(clientX, clientY);
        if (hit === null) {
          flash(t("noHit"));
          return;
        }
        const resolved = resolverRef.current !== null ? resolverRef.current.resolve(hit) : null;
        const item = {
          id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
          target,
          hit: { ...hit },
          resolved,
          source: {
            path: absolutePath,
            version,
            cacheKey: payload && payload.cache ? payload.cache.key || null : null,
            bytes: payload && payload.file ? payload.file.bytes : null,
            mtimeMs: payload && payload.file ? payload.file.mtimeMs : null,
            recipe: payload && payload.scene ? payload.scene.recipe : null,
            mmPerUnit: payload && payload.scene && payload.scene.unit ? payload.scene.unit.millimeters_per_unit : 1000,
            frame: payload && payload.scene ? payload.scene.frame : null,
          },
          view: viewer.getView(),
          comment: "",
          stale: false,
        };
        item.anchor = anchorFor(item, target);
        setDraft(item);
        setSelectedId(null);
      };

      const changeTarget = (next) => {
        setTarget(next);
        setDraft((current) => (current === null ? current : { ...current, target: next, anchor: anchorFor(current, next) }));
      };

      // Keep the pins glued to the model while orbiting (direct DOM writes, no React render per frame).
      viewRef.current = () => {
        const viewer = viewerRef.current;
        if (viewer === null) return;
        const rect = viewer.canvas.getBoundingClientRect();
        const now = typeof performance !== "undefined" ? performance.now() : Date.now();
        const checkOcclusion = now - occlusionAt.current > 140;
        if (checkOcclusion) occlusionAt.current = now;
        for (const item of pinItemsRef.current) {
          const element = pinElements.current[item.id];
          if (!element) continue;
          const at = viewer.project(item.anchor);
          const offscreen = item.stale || !at.visible || at.x < -12 || at.y < -12 || at.x > rect.width + 12 || at.y > rect.height + 12;
          element.dataset.offscreen = offscreen ? "true" : "false";
          if (offscreen) continue;
          element.style.transform = `translate(${at.x}px, ${at.y}px)`;
          if (checkOcclusion) element.dataset.occluded = viewer.isUnoccluded(item.anchor) ? "false" : "true";
        }
      };
      pinItemsRef.current = draft === null ? annotations : [...annotations, draft];
      React.useLayoutEffect(() => {
        occlusionAt.current = 0;
        viewRef.current();
      }, [annotations, draft]);

      // Highlight the draft, or the selected saved annotation.
      React.useEffect(() => {
        const viewer = viewerRef.current;
        if (viewer === null || state !== "ready") return;
        const item = draft !== null ? draft : annotations.find((entry) => entry.id === selectedId);
        viewer.setOverlay(item ? overlayFor(viewer, item) : null);
      }, [draft, selectedId, annotations, state]);

      // Persist per file; annotations from an older file version are kept and flagged.
      React.useEffect(() => {
        if (!loadedRef.current || loadedPathRef.current === null) return;
        storeAnnotations(loadedPathRef.current, loadedVersionRef.current, annotations);
      }, [annotations]);

      const settle = React.useCallback(
        (ok, fileVersion) => {
          if (reported.current === revision) return;
          reported.current = revision;
          if (content === undefined || content.kind !== "renderer") return;
          if (ok) content.loaded(fileVersion);
          else content.failed();
        },
        [content, revision]
      );
      const settleRef = React.useRef(settle);
      settleRef.current = settle;

      // The canvas only exists once the resource metadata resolves, so the
      // viewer is created from the ref callback rather than a mount effect.
      const attachCanvas = React.useCallback((node) => {
        if (node === null) {
          viewerRef.current?.dispose();
          viewerRef.current = null;
          return;
        }
        if (viewerRef.current !== null) return;
        try {
          viewerRef.current = createViewer(node, {
            onClick: (x, y) => clickRef.current(x, y),
            onView: () => viewRef.current(),
          });
          viewerErrorRef.current = "";
          setViewerError("");
        } catch (error) {
          const message = String(error && error.message ? error.message : error);
          viewerErrorRef.current = message;
          setViewerError(message);
          // The failure is shown in the overlay; the console line keeps the
          // shader/context detail reachable when the overlay is not enough.
          console.error("[blender-annotate] viewer init failed:", error);
        }
      }, []);

      React.useEffect(() => {
        viewerRef.current?.setWireframe(wireframe);
      }, [wireframe]);

      React.useEffect(() => {
        viewerRef.current?.setAutoRotate(autoRotate);
      }, [autoRotate]);

      React.useEffect(() => {
        if (absolutePath === undefined) return undefined;
        const controller = new AbortController();
        let tick = 0;
        const timer = setInterval(() => {
          tick += 1;
          setElapsed(tick);
        }, 1000);
        loadedRef.current = false;
        setState("loading");
        setFailure(null);
        setPayload(null);
        setStats(null);
        setElapsed(0);

        (async () => {
          const infoResponse = await fetch(assetUrl(routePath, absolutePath, "info", version), {
            signal: controller.signal,
            credentials: "same-origin",
          });
          const infoBody = await infoResponse.json().catch(() => null);
          if (!infoResponse.ok) {
            throw infoBody && infoBody.error ? infoBody.error : { message: tRef.current("readFailed"), code: "HTTP_" + String(infoResponse.status) };
          }
          if (controller.signal.aborted) return;
          setPayload(infoBody);
          setState("exporting");

          const glbResponse = await fetch(assetUrl(routePath, absolutePath, "glb", version), {
            signal: controller.signal,
            credentials: "same-origin",
          });
          if (!glbResponse.ok) {
            const glbBody = await glbResponse.json().catch(() => null);
            throw glbBody && glbBody.error ? glbBody.error : { message: tRef.current("readFailed"), code: "HTTP_" + String(glbResponse.status) };
          }
          const bytes = await glbResponse.arrayBuffer();
          if (controller.signal.aborted) return;
          const viewer = viewerRef.current;
          if (viewer === null) {
            const detail = viewerErrorRef.current;
            throw {
              message: tRef.current("webglMissing") + (detail === "" ? "" : " " + detail),
              code: "WEBGL_MISSING",
            };
          }
          const sceneInfo = infoBody && infoBody.scene ? infoBody.scene : null;
          const modelStats = viewer.setModel(bytes, { worldFor: exactWorldFor(sceneInfo ? sceneInfo.annotate : null) });
          resolverRef.current = sceneInfo && sceneInfo.annotate
            ? createResolver(sceneInfo.annotate, sceneInfo.unit ? sceneInfo.unit.millimeters_per_unit : 1000)
            : null;
          const stored = loadAnnotations(absolutePath);
          const changed = stored.version !== null && stored.version !== version;
          loadedRef.current = true;
          loadedPathRef.current = absolutePath;
          loadedVersionRef.current = version;
          setAnnotations(stored.items.map((item) => (changed ? { ...item, stale: true } : item)));
          if (stored.items.length > 0) setPanelTab("annotations");
          setDraft(null);
          setStats(modelStats);
          setState("ready");
          settleRef.current(true, version);
        })().catch((error) => {
          if (controller.signal.aborted) return;
          setFailure({
            code: typeof error?.code === "string" ? error.code : "UNKNOWN",
            message: error instanceof Error ? error.message : String(error?.message ?? error),
            hint: error?.hint,
            detail: error?.detail,
          });
          setState("failed");
          settleRef.current(false, version);
        });

        return () => {
          controller.abort();
          clearInterval(timer);
        };
      }, [absolutePath, version, attempt, routePath]);

      if (absolutePath === undefined) {
        const failed = meta.status === "failed";
        return React.createElement(
          "div",
          { "data-blender-annotate": true, "data-blend-state": failed ? "failed" : "loading" },
          React.createElement(
            "div",
            { className: "dsh-bp-viewport" },
            React.createElement(
              "div",
              { className: "dsh-bp-overlay" },
              failed
                ? React.createElement(
                    "div",
                    { className: "dsh-bp-card", "data-tone": "error" },
                    React.createElement("p", { className: "dsh-bp-title" }, t("failed")),
                    React.createElement("p", { className: "dsh-bp-text" }, t("readFailed")),
                    React.createElement(
                      "button",
                      { type: "button", className: "dsh-bp-button", onClick: () => setAttempt((value) => value + 1) },
                      t("retry")
                    )
                  )
                : React.createElement(
                    "div",
                    { className: "dsh-bp-card" },
                    React.createElement("div", { className: "dsh-bp-spinner" }),
                    React.createElement("p", { className: "dsh-bp-text" }, t("preparing"))
                  )
            )
          )
        );
      }

      const scene = payload && payload.scene ? payload.scene : null;
      const counts = scene && scene.counts ? scene.counts : null;
      const materials = scene && Array.isArray(scene.materials) ? scene.materials : [];
      const objects = scene && Array.isArray(scene.objects)
        ? scene.objects.filter((entry) => entry.type === "MESH" && entry.visible !== false)
        : [];
      const name = scene && scene.file_name ? scene.file_name : basenameOf(absolutePath);
      const triangles = stats !== null ? stats.triangles : counts !== null ? counts.triangles : 0;

      const attachFiles = (files) => {
        if (typeof createDraftsFor !== "function" || inputActions === undefined || typeof inputActions.addAttachments !== "function") return false;
        try {
          const ids = createDraftsFor(sessionId)(files);
          return inputActions.addAttachments(ids) !== false;
        } catch (error) {
          console.warn("[blender-annotate] attachment failed:", error);
          return false;
        }
      };

      const saveDraft = () => {
        if (draft === null) return;
        const saved = { ...draft, comment: draft.comment.trim() };
        setAnnotations((items) => [...items, saved]);
        setDraft(null);
        setSelectedId(saved.id);
        setPanelTab("annotations");
        setPanelOpen(true);
      };

      const send = async () => {
        const viewer = viewerRef.current;
        if (annotations.length === 0 || viewer === null) return;
        if (draft !== null) { flash(t("saveFirst")); return; }
        if (inputActions === undefined || typeof inputActions.setDraft !== "function") {
          flash(t("sendFailed"));
          return;
        }
        const message = buildMessage(t, name, absolutePath, annotations);
        const current = typeof composerDraft === "string" ? composerDraft : "";
        inputActions.setDraft(current.trim() === "" ? message : `${current}\n\n${message}`);
        let attached = false;
        try {
          const file = await canvasToFile(snapshotWithPins(viewer, annotations), "blender-annotations");
          attached = attachFiles([file]);
        } catch (error) {
          console.warn("[blender-annotate] snapshot not attached:", error);
        }
        flash(t(attached ? "sent" : "sentNoSnapshot"));
      };

      const openSketch = () => {
        const viewer = viewerRef.current;
        if (viewer === null) return;
        const capture = snapshotWithPins(viewer, draft === null ? annotations : [...annotations, draft]);
        setSketch({ src: capture.toDataURL("image/png"), width: capture.width, height: capture.height });
      };

      const loading = state === "loading" || state === "exporting";
      const toolbar = React.createElement(
        "div",
        { className: "dsh-bp-toolbar" },
        React.createElement("div", { className: "dsh-bp-name", title: absolutePath }, name),
        React.createElement(
          "div",
          { className: "dsh-bp-actions" },
          React.createElement(
            "button",
            {
              type: "button",
              className: "dsh-bp-button",
              title: t("reset") + " (Home)",
              "data-blend-action": "reset",
              onClick: () => viewerRef.current?.resetView(),
            },
            t("reset")
          ),
          React.createElement(
            "button",
            {
              type: "button",
              className: "dsh-bp-button",
              title: t("wireframe"),
              "data-blend-action": "wireframe",
              "data-active": wireframe ? "true" : "false",
              "aria-pressed": wireframe ? "true" : "false",
              onClick: () => setWireframe((value) => !value),
            },
            t("wireframe")
          ),
          React.createElement(
            "button",
            {
              type: "button",
              className: "dsh-bp-button",
              title: t("spin"),
              "data-blend-action": "spin",
              "data-active": autoRotate ? "true" : "false",
              "aria-pressed": autoRotate ? "true" : "false",
              onClick: () => setAutoRotate((value) => !value),
            },
            t("spin")
          ),
          React.createElement(
            "button",
            {
              type: "button",
              className: "dsh-bp-button",
              title: t("info"),
              "data-blend-action": "info",
              "data-active": panelOpen ? "true" : "false",
              "aria-pressed": panelOpen ? "true" : "false",
              onClick: () => setPanelOpen((value) => !value),
            },
            t("info")
          ),
          React.createElement(
            "button",
            {
              type: "button",
              className: "dsh-bp-button",
              "data-blend-action": "annotate",
              "data-active": annotating ? "true" : "false",
              "aria-pressed": annotating ? "true" : "false",
              disabled: state !== "ready",
              onClick: () => {
                setAnnotating((value) => !value);
                if (annotating) setDraft(null);
              },
            },
            t("annotate")
          ),
          React.createElement(
            "button",
            { type: "button", className: "dsh-bp-button", "data-blend-action": "sketch", disabled: state !== "ready", onClick: openSketch },
            t("sketch")
          ),
          React.createElement(
            "button",
            {
              type: "button",
              className: "dsh-bp-button",
              "data-blend-action": "send",
              disabled: state !== "ready" || annotations.length === 0,
              onClick: () => void send(),
            },
            t("send") + (annotations.length > 0 ? ` (${annotations.length})` : "")
          )
        ),
        annotating
          ? React.createElement(
              "div",
              { className: "dsh-ba-targets", role: "radiogroup", "aria-label": t("annotate") },
              TARGETS.map((id) =>
                React.createElement(
                  "button",
                  {
                    key: id,
                    type: "button",
                    role: "radio",
                    className: "dsh-bp-button",
                    "data-blend-target": id,
                    "data-active": target === id ? "true" : "false",
                    "aria-checked": target === id ? "true" : "false",
                    onClick: () => changeTarget(id),
                  },
                  t(TARGET_LABEL[id])
                )
              )
            )
          : null
      );

      const overlay = loading
        ? React.createElement(
            "div",
            { className: "dsh-bp-overlay" },
            React.createElement(
              "div",
              { className: "dsh-bp-card" },
              React.createElement("div", { className: "dsh-bp-spinner" }),
              React.createElement("p", { className: "dsh-bp-title" }, t("loading")),
              React.createElement("p", { className: "dsh-bp-text" }, t("loadingHint")),
              React.createElement("p", { className: "dsh-bp-text", "data-blend-elapsed": true }, fill(t("elapsed"), { seconds: elapsed }))
            )
          )
        : state === "failed"
          ? React.createElement(
              "div",
              { className: "dsh-bp-overlay" },
              React.createElement(
                "div",
                { className: "dsh-bp-card", "data-tone": "error" },
                React.createElement("p", { className: "dsh-bp-title" }, t("failed")),
                React.createElement("p", { className: "dsh-bp-code", "data-blend-error-code": true }, failure?.code ?? ""),
                React.createElement("p", { className: "dsh-bp-text", "data-blend-error-message": true }, failure?.message ?? ""),
                failure?.hint ? React.createElement("p", { className: "dsh-bp-text" }, failure.hint) : null,
                React.createElement(
                  "button",
                  {
                    type: "button",
                    className: "dsh-bp-button",
                    "data-blend-action": "retry",
                    onClick: () => setAttempt((value) => value + 1),
                  },
                  t("retry")
                ),
                failure?.detail
                  ? React.createElement(
                      "details",
                      { className: "dsh-bp-details" },
                      React.createElement("summary", null, t("details")),
                      React.createElement("pre", null, failure.detail)
                    )
                  : null
              )
            )
          : null;

      const viewport = React.createElement(
        "div",
        { className: "dsh-bp-viewport" },
        React.createElement("canvas", {
          ref: attachCanvas,
          className: "dsh-bp-canvas",
          "data-blend-canvas": true,
          "data-annotating": annotating ? "true" : "false",
          tabIndex: 0,
          "aria-label": name,
        }),
        React.createElement(
          "div",
          { className: "dsh-ba-pins", "data-blend-pins": true },
          pinItemsRef.current.map((item) => {
            const isDraft = draft !== null && item.id === draft.id;
            const number = isDraft ? annotations.length + 1 : annotations.indexOf(item) + 1;
            return React.createElement(
              "div",
              {
                key: item.id,
                ref: (element) => {
                  if (element === null) delete pinElements.current[item.id];
                  else pinElements.current[item.id] = element;
                },
                className: "dsh-ba-pin",
                "data-draft": isDraft ? "true" : "false",
                "data-offscreen": "true",
                title: item.resolved ? selectorOf(item.resolved, item.target) : item.hit.nodeName,
                onClick: () => {
                  if (isDraft) return;
                  setSelectedId(item.id);
                  setPanelTab("annotations");
                  setPanelOpen(true);
                },
              },
              String(number)
            );
          })
        ),
        notice !== "" ? React.createElement("div", { className: "dsh-ba-notice", "data-blend-notice": true }, notice) : null,
        draft !== null
          ? React.createElement(
              "div",
              { className: "dsh-ba-draft", "data-blend-draft": true },
              React.createElement(
                "div",
                { className: "dsh-ba-selector" },
                `${annotations.length + 1}. ` + (draft.resolved ? selectorOf(draft.resolved, draft.target) : draft.hit.nodeName)
              ),
              React.createElement(
                "div",
                { className: "dsh-ba-meta" },
                t(TARGET_LABEL[draft.target]) + " · " + t(PRECISION_LABEL[draft.resolved ? draft.resolved.precision : "object"] || "precisionObject")
              ),
              React.createElement("textarea", {
                autoFocus: true,
                value: draft.comment,
                placeholder: t("commentPlaceholder"),
                onChange: (event) => {
                  const value = event.target.value;
                  setDraft((current) => (current === null ? current : { ...current, comment: value }));
                },
                onKeyDown: (event) => {
                  if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) saveDraft();
                  if (event.key === "Escape") setDraft(null);
                },
              }),
              draft.resolved
                ? React.createElement(
                    "details",
                    { className: "dsh-ba-details" },
                    React.createElement("summary", null, t("parameters")),
                    React.createElement("pre", null, describeResolved(draft.resolved, draft.target))
                  )
                : null,
              React.createElement(
                "div",
                { className: "dsh-ba-row" },
                React.createElement("button", { type: "button", className: "dsh-bp-button", onClick: () => setDraft(null) }, t("cancel")),
                React.createElement("button", { type: "button", className: "dsh-bp-button", "data-active": "true", "data-blend-action": "save-annotation", onClick: saveDraft }, t("save"))
              )
            )
          : null,
        state === "ready"
          ? React.createElement(
              "div",
              { className: "dsh-bp-badge", "data-blend-badge": true },
              formatCount(triangles) + " " + t("triangles")
            )
          : null,
        state === "ready" && draft === null ? React.createElement("div", { className: "dsh-bp-hint" }, annotating ? t("annotateHint") : t("hint")) : null,
        overlay,
        viewerError !== "" && state !== "failed"
          ? React.createElement(
              "div",
              { className: "dsh-bp-overlay" },
              React.createElement(
                "div",
                { className: "dsh-bp-card", "data-tone": "error" },
                React.createElement("p", { className: "dsh-bp-title" }, t("failed")),
                React.createElement("p", { className: "dsh-bp-text" }, t("webglMissing")),
                React.createElement("p", { className: "dsh-bp-code" }, viewerError)
              )
            )
          : null
      );

      const summaryRows = [];
      if (scene !== null) {
        summaryRows.push([t("size"), formatSize(scene.bounds ? scene.bounds.size_mm : null)]);
        summaryRows.push([t("objects"), formatCount(counts ? counts.visible_meshes : objects.length)]);
        summaryRows.push([t("triangles"), formatCount(triangles)]);
        summaryRows.push([t("materials"), formatCount(counts ? counts.materials : materials.length)]);
        if (counts && (counts.cameras > 0 || counts.lights > 0)) {
          summaryRows.push([t("cameras"), formatCount(counts.cameras)]);
          summaryRows.push([t("lights"), formatCount(counts.lights)]);
        }
        summaryRows.push([t("scene"), scene.scene ?? "—"]);
        summaryRows.push([t("unit"), scene.unit ? `${scene.unit.length_unit} (${scene.unit.millimeters_per_unit} mm/unit)` : "—"]);
      }

      const objectRows = objects.map((entry) =>
        React.createElement(
          "tr",
          { key: entry.name, "data-blend-object": entry.name },
          React.createElement(
            "td",
            null,
            React.createElement("span", {
              className: "dsh-bp-swatch",
              style: { background: swatchFor(entry, materials) },
            }),
            entry.name
          ),
          React.createElement("td", { className: "num" }, formatCount(entry.triangles)),
          React.createElement("td", { className: "num" }, formatSize(entry.dims_mm))
        )
      );

      const tabs = React.createElement(
        "div",
        { className: "dsh-ba-tabs", role: "tablist" },
        React.createElement(
          "button",
          { type: "button", role: "tab", className: "dsh-bp-button", "data-active": panelTab === "info" ? "true" : "false", "aria-selected": panelTab === "info", onClick: () => setPanelTab("info") },
          t("info")
        ),
        React.createElement(
          "button",
          {
            type: "button",
            role: "tab",
            className: "dsh-bp-button",
            "data-blend-tab": "annotations",
            "data-active": panelTab === "annotations" ? "true" : "false",
            "aria-selected": panelTab === "annotations",
            onClick: () => setPanelTab("annotations"),
          },
          t("annotations") + (annotations.length > 0 ? ` (${annotations.length})` : "")
        )
      );

      const annotationList = annotations.length === 0
        ? React.createElement("p", { className: "dsh-bp-text", style: { color: "inherit", opacity: 0.6 } }, t("noAnnotations"))
        : React.createElement(
            "div",
            { className: "dsh-ba-list", "data-blend-annotations": true },
            annotations.map((item, index) =>
              React.createElement(
                "div",
                { className: "dsh-ba-item", key: item.id, "data-selected": item.id === selectedId ? "true" : "false", style: item.id === selectedId ? { background: "var(--dsw-alias-interactive-bg-hover, rgba(0,0,0,.04))" } : undefined },
                React.createElement("span", { className: "dsh-ba-num" }, String(index + 1)),
                React.createElement(
                  "div",
                  { style: { minWidth: 0 } },
                  React.createElement("div", { className: "dsh-ba-selector" }, item.resolved ? selectorOf(item.resolved, item.target) : item.hit.nodeName),
                  React.createElement(
                    "div",
                    { className: "dsh-ba-meta" },
                    t(TARGET_LABEL[item.target]) + " · " + t(PRECISION_LABEL[item.resolved ? item.resolved.precision : "object"] || "precisionObject") + (item.stale ? " · " + t("stale") : "")
                  ),
                  item.comment ? React.createElement("p", null, item.comment) : null
                ),
                React.createElement(
                  "div",
                  { className: "dsh-ba-row", style: { flexWrap: "nowrap" } },
                  React.createElement(
                    "button",
                    {
                      type: "button",
                      className: "dsh-bp-button",
                      onClick: () => {
                        viewerRef.current?.setView(item.view);
                        setSelectedId(item.id);
                      },
                    },
                    t("goTo")
                  ),
                  React.createElement(
                    "button",
                    {
                      type: "button",
                      className: "dsh-bp-button",
                      onClick: () => {
                        setAnnotations((items) => items.filter((entry) => entry.id !== item.id));
                        if (selectedId === item.id) setSelectedId(null);
                      },
                    },
                    t("remove")
                  )
                )
              )
            )
          );

      const infoContent = scene === null
          ? React.createElement("p", { className: "dsh-bp-text" }, t("noSceneInfo"))
          : React.createElement(
              React.Fragment,
              null,
              React.createElement(
                "div",
                { className: "dsh-bp-summary" },
                summaryRows.map(([label, value]) =>
                  React.createElement(
                    "div",
                    { className: "dsh-bp-kv", key: label },
                    React.createElement("span", null, label),
                    React.createElement("span", { title: value }, value)
                  )
                )
              ),
              objectRows.length > 0
                ? React.createElement(
                    "table",
                    { className: "dsh-bp-table" },
                    React.createElement(
                      "thead",
                      null,
                      React.createElement(
                        "tr",
                        null,
                        React.createElement("th", null, t("objects")),
                        React.createElement("th", { className: "num" }, t("triangles")),
                        React.createElement("th", { className: "num" }, t("size"))
                      )
                    ),
                    React.createElement("tbody", null, objectRows)
                  )
                : null,
              materials.length > 0
                ? React.createElement(
                    "div",
                    { className: "dsh-bp-materials" },
                    materials.map((material) =>
                      React.createElement(
                        "span",
                        { className: "dsh-bp-chip", key: material.name, title: material.name },
                        React.createElement("span", {
                          className: "dsh-bp-swatch",
                          style: { background: material.hex || "#8a94a6", marginRight: "0" },
                        }),
                        material.name
                      )
                    )
                  )
                : null,
              React.createElement(
                "div",
                { className: "dsh-bp-footer" },
                React.createElement(
                  "span",
                  null,
                  fill(t("exportMeta"), {
                    blender: payload && payload.blender ? payload.blender : scene.blender ?? "Blender",
                    size: formatBytes(payload && payload.cache ? payload.cache.glbBytes : 0),
                    time:
                      payload && payload.cache && payload.cache.cached
                        ? t("cached")
                        : fill(t("exportedIn"), {
                            seconds:
                              payload && payload.cache && typeof payload.cache.elapsedMs === "number"
                                ? (payload.cache.elapsedMs / 1000).toFixed(1)
                                : "?",
                          }),
                  })
                ),
                counts !== null && typeof counts.collections === "number"
                  ? React.createElement("span", null, `${t("collections")}: ${formatCount(counts.collections)}`)
                  : null
              )
            );

      const panel = React.createElement(
        "div",
        { className: "dsh-bp-panel", "data-blend-panel": true, "data-open": panelOpen ? "true" : "false" },
        tabs,
        panelTab === "annotations" ? annotationList : infoContent
      );

      return React.createElement(
        "div",
        {
          "data-blender-annotate": true,
          "data-blend-state": state,
          "data-blend-triangles": String(triangles),
        },
        toolbar,
        viewport,
        panel,
        sketch === null
          ? null
          : React.createElement(SketchEditor, {
              src: sketch.src,
              width: sketch.width,
              height: sketch.height,
              t,
              onCancel: () => setSketch(null),
              onCommit: async (file) => {
                if (attachFiles([file])) flash(t("sketchAdded"));
                else flash(t("sendFailed"));
                setSketch(null);
              },
            })
      );
    }

    const inject = ["slots", "locale", "resources", "documentPreviews", "sessions"];

    /**
     * Register the Blender renderer and its body for the plugin's lifetime.
     * @param ctx - client root context.
     */
    function apply(ctx) {
      installStyle();
      const t = ctx.locale.bind(NS);
      ctx.effect(() => ctx.locale.register(NS, { zh, en }), "blender-annotate: dictionaries");
      const config = configuredConfig();
      // Composer attachments go through the session's conversation service, as in dsh-preview-snip.
      const createDraftsFor = (sessionId) => (files) => {
        const scope = ctx.sessions?.scope?.(sessionId);
        const conversation = scope?.get?.("conversation");
        if (conversation === undefined) throw new Error("conversation unavailable");
        return conversation.createDrafts(sessionId, files).map((draft) => draft.id);
      };
      const bodyInject = () => ({ routePath: config.routePath, t, createDraftsFor });
      ctx.effect(
        () =>
          ctx.documentPreviews.register({
            id: BODY_ID,
            extensions: config.extensions,
            binaryExtensions: config.extensions,
            priority: "extension",
            title: () => t("blender"),
            loading: "renderer",
            wrap: false,
          }),
        "blender-annotate: metadata"
      );
      ctx.effect(
        () =>
          ctx.slots.inject("sidebar.right.tab.document", () =>
            ctx.slots.register(
              {
                name: "sidebar.right.tab.document",
                key: BODY_ID,
                locale: NS,
                inject: bodyInject,
              },
              BlendBody
            )
          ),
        "blender-annotate: body"
      );
    }

    exports.apply = apply;
    exports.inject = inject;
    exports.__createViewer = createViewer;
    return module.exports;
  },
});
