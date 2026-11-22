/**
 * dsh-blender-annotate — open a Blender .blend in the DSH right-Sidebar document
 * preview instead of the built-in "binary file, no preview" empty state.
 *
 * Two halves, one package:
 * - this file is the Host half: it owns the conversion service (one Blender
 *   process per file version, cached on disk) and registers an authenticated
 *   `GET|HEAD /api/blender-annotate` route that serves the scene JSON and the
 *   exported GLB.
 * - `./client` is the browser half: it registers a document-preview renderer
 *   for `.blend` suffixes and draws the GLB in a small WebGL viewport with
 *   orbit/zoom, a wireframe mode, and a scene-information panel.
 *
 * @module dsh-blender-annotate
 */
import { BlendExporter } from "./blender.js";
import { resolveConfig } from "./config.js";
import { Config } from "./schema.js";
import { registerBlendRoute } from "./route.js";

/** Plugin name, also the settings-page namespace through the bundle patch. */
export const name = "blender-annotate";

/** Host service the route needs: the authenticated `/api` fence. */
export const inject = ["connection"];

export { Config };

/**
 * Mount the conversion route and expose its path to the browser half.
 * @param ctx - host context carrying `connection`.
 * @param config - loader-supplied configuration.
 */
export function apply(ctx, config) {
  const settings = resolveConfig(config);
  if (!settings.enabled) return;
  const exporter = new BlendExporter(settings, { logger: ctx.logger });

  ctx.effect(() => registerBlendRoute(ctx, exporter, settings), "blender-annotate: conversion route");
  ctx.effect(() => () => exporter.dispose(), "blender-annotate: blender processes");

  // The client reads its route from the served page, so a configured path and
  // the client's URL can never drift apart.
  ctx.on("webserver/index-inject", (table) => {
    table.push({
      kind: "global",
      name: "__DSH_BLENDER_ANNOTATE_CONFIG__",
      value: { routePath: settings.routePath, extensions: settings.extensions },
    });
  });
}
