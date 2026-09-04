import * as THREE from "three";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";
import { useGLBStore } from "@/store/glbStore";

/** Bytes → "1.4 MB". */
export function formatBytes(bytes: number): string {
  if (!bytes || bytes < 0) return "—";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  return `${parseFloat((bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1))} ${units[i]}`;
}

/** Strip characters that are illegal in filenames and force a .glb extension. */
export function sanitizeFilename(name: string): string {
  const base = name
    .replace(/\.gl(b|tf)$/i, "")
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, " ")
    .trim();
  return `${base || "model"}.glb`;
}

/** Serialize a scene subtree to GLB bytes. */
export function exportGLB(root: THREE.Object3D): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    new GLTFExporter().parse(
      root,
      (result) => resolve(result as ArrayBuffer),
      (err) => reject(err),
      { binary: true }
    );
  });
}

/**
 * Squeeze the serialized GLB with gltf-transform's lossless passes. Returns the
 * input untouched if the document can't be round-tripped (unknown extensions).
 */
export async function compressGLB(buffer: ArrayBuffer): Promise<ArrayBuffer> {
  try {
    const [{ WebIO }, { dedup, prune }] = await Promise.all([
      import("@gltf-transform/core"),
      import("@gltf-transform/functions"),
    ]);
    const io = new WebIO();
    const doc = await io.readBinary(new Uint8Array(buffer));
    await doc.transform(dedup(), prune());
    const out = await io.writeBinary(doc);
    // Never hand back something larger than what we were given.
    if (out.byteLength >= buffer.byteLength) return buffer;
    return out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength) as ArrayBuffer;
  } catch (err) {
    console.warn("glb compression skipped:", err);
    return buffer;
  }
}

/** Real serialized size of the current scene, in bytes. Not an estimate. */
export async function measureGLBSize(root: THREE.Object3D): Promise<number> {
  const raw = await exportGLB(root);
  const packed = await compressGLB(raw);
  return packed.byteLength;
}

/** Trigger a browser download. Only ever called from an explicit export action. */
export function downloadGLB(buffer: ArrayBuffer, filename: string) {
  const blob = new Blob([buffer], { type: "model/gltf-binary" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = sanitizeFilename(filename);
  a.click();
  // Revoke on the next tick; revoking synchronously can cancel the download.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Re-measure the loaded model and write the real byte size into the store.
 * Reads the scene root from the store so it needs no arguments and is a stable
 * reference for effects.
 */
export async function remeasureModel() {
  const root = useGLBStore.getState().gltfRoot;
  if (!root) return;
  useGLBStore.getState().setMeasuring(true);
  try {
    const bytes = await measureGLBSize(root);
    const store = useGLBStore.getState();
    store.setCurrentBytes(bytes);
    if (store.baselineBytes === null) store.setBaselineBytes(bytes);
  } catch (err) {
    console.warn("size measurement failed:", err);
  } finally {
    useGLBStore.getState().setMeasuring(false);
  }
}
