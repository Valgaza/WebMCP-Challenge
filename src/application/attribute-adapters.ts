import { flattenLayers, type Layer } from "../domain/layer";
import { ProjectError } from "../domain/project-error";
import type { AttributeBundle } from "../domain/preset";
import type { AttributeTargetAdapter } from "./preset-service";
import type { ProjectService } from "./project-service";

/**
 * The bridge between the reuse engine and the objects it edits.
 *
 * An adapter answers two questions for one kind of object: what are its attributes now, and
 * how are new ones written to many of them at once. A layer edit commits a whole before/after
 * state, so applying a bundle to forty layers is naturally one transaction and one Undo step.
 */

/** Layers in the photo document. */
export function createLayerAdapter(projects: ProjectService): AttributeTargetAdapter {
  const documentOf = async (projectId: string) => {
    const history = await projects.getProjectHistory(projectId);
    const document = history.headRevision.state.photoDocument;
    if (!document) throw new ProjectError("INVALID_INPUT", "This project has no image document.", { fieldPath: "projectId" });
    return document;
  };

  return {
    domain: "layer",

    read: async (projectId, targetId) => {
      const document = await documentOf(projectId);
      const found = flattenLayers(document.layers).find((entry) => entry.layer.id === targetId);
      if (!found) return null;
      const layer = found.layer;
      // Colour and crop belong to image layers; a text or vector layer has neither, so the
      // bundle simply carries fewer attributes rather than inventing them.
      return {
        ...(layer.kind === "image" ? { adjustments: layer.adjustments, crop: layer.crop } : {}),
        transform: layer.transform,
        opacity: layer.opacity,
        visible: layer.visible,
      };
    },

    applyMany: async (projectId, targetIds, attributes, context, label) => {
      const document = await documentOf(projectId);
      const wanted = new Set(targetIds);

      const rewrite = (layers: readonly Layer[]): Layer[] => layers.map((layer) => {
        if (layer.kind === "group") return { ...layer, children: rewrite(layer.children) };
        if (!wanted.has(layer.id)) return layer;
        const shared = {
          // A partial transform merges rather than replaces, so pasting "just the rotation"
          // leaves a layer where it was instead of moving it to the source's position.
          transform: attributes.transform ? { ...layer.transform, ...attributes.transform } : layer.transform,
          opacity: attributes.opacity ?? layer.opacity,
          visible: attributes.visible ?? layer.visible,
        };
        return layer.kind === "image"
          ? {
            ...layer, ...shared,
            adjustments: attributes.adjustments ?? layer.adjustments,
            crop: attributes.crop ?? layer.crop,
          }
          : { ...layer, ...shared };
      });

      return projects.applyLayers(
        { projectId, documentId: document.id, label, fromLayers: document.layers, toLayers: rewrite(document.layers) },
        context,
      );
    },
  };
}
