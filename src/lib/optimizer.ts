import * as THREE from "three";
import {
  mergeVertices,
  deinterleaveGeometry,
} from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { MeshoptSimplifier } from "meshoptimizer";

// ─── Levels ───────────────────────────────────────────────────────────────

export type LevelId = "quick" | "medium" | "ultra" | "lowpoly";

export interface OptimizationLevel {
  id: LevelId;
  label: string;
  blurb: string;
  /** Fraction of triangles to keep. 1 = no geometry reduction. */
  triangleRatio: number;
  /**
   * Sloppy simplification ignores mesh topology. It reaches aggressive targets
   * on assets a topology-preserving pass would refuse to reduce, at the cost of
   * seams and UV distortion — which is exactly the low-poly look.
   */
  sloppy: boolean;
  /** Longest texture edge, in pixels. */
  maxTexture: number;
  /** JPEG quality used when the exporter re-encodes opaque textures. */
  jpegQuality: number;
  /** Material map slots removed entirely. */
  dropMaps: string[];
  /** Faceted shading (also drops the normal attribute). */
  flatShading: boolean;
  /** Replace every texture with its average colour. */
  bakeTexturesToColor: boolean;
  accent: string;
}

export const OPTIMIZATION_LEVELS: OptimizationLevel[] = [
  {
    id: "quick",
    label: "Quick Optimization",
    blurb: "Lossless clean-up. Welds duplicate vertices and caps oversized textures. Geometry is untouched.",
    triangleRatio: 1,
    sloppy: false,
    maxTexture: 2048,
    jpegQuality: 0.92,
    dropMaps: [],
    flatShading: false,
    bakeTexturesToColor: false,
    accent: "#4caf90",
  },
  {
    id: "medium",
    label: "Medium Optimized",
    blurb: "Halves the triangle count and drops textures to 1K. Keeps the full PBR material.",
    triangleRatio: 0.5,
    sloppy: false,
    maxTexture: 1024,
    jpegQuality: 0.8,
    dropMaps: ["aoMap"],
    flatShading: false,
    bakeTexturesToColor: false,
    accent: "#5b6ef5",
  },
  {
    id: "ultra",
    label: "Ultra Optimized",
    blurb: "Keeps 20% of triangles, 512px textures, and only base colour plus normals.",
    triangleRatio: 0.2,
    sloppy: false,
    maxTexture: 512,
    jpegQuality: 0.65,
    dropMaps: ["aoMap", "emissiveMap", "metalnessMap", "roughnessMap", "displacementMap"],
    flatShading: false,
    bakeTexturesToColor: false,
    accent: "#f5a623",
  },
  {
    id: "lowpoly",
    label: "Low-Poly",
    blurb: "Converts any asset into a faceted low-poly model. Textures are baked down to flat colours.",
    triangleRatio: 0.05,
    sloppy: true,
    maxTexture: 128,
    jpegQuality: 0.5,
    dropMaps: [
      "aoMap",
      "emissiveMap",
      "metalnessMap",
      "roughnessMap",
      "normalMap",
      "displacementMap",
      "alphaMap",
      "map",
    ],
    flatShading: true,
    bakeTexturesToColor: true,
    accent: "#e05fd8",
  },
];

export function getLevel(id: LevelId): OptimizationLevel {
  return OPTIMIZATION_LEVELS.find((l) => l.id === id) ?? OPTIMIZATION_LEVELS[0];
}

const TEXTURE_SLOTS = [
  "map",
  "normalMap",
  "roughnessMap",
  "metalnessMap",
  "emissiveMap",
  "aoMap",
  "displacementMap",
  "alphaMap",
] as const;

// ─── Pristine source cache ────────────────────────────────────────────────
//
// Every level is applied to the ORIGINAL mesh, never to an already-optimized
// one. Without this, picking Medium then Low-Poly would compound two lossy
// passes and land somewhere unpredictable.

interface Original {
  geometry: THREE.BufferGeometry;
  material: THREE.Material | THREE.Material[];
}

const originals = new Map<string, Original>();

/** Remember a mesh's pristine geometry/material the first time we touch it. */
function rememberOriginal(mesh: THREE.Mesh): Original {
  const existing = originals.get(mesh.uuid);
  if (existing) return existing;
  const entry: Original = { geometry: mesh.geometry, material: mesh.material };
  originals.set(mesh.uuid, entry);
  return entry;
}

/**
 * Every level result we have built, keyed uuid → level. Cached rather than
 * rebuilt-and-disposed for two reasons: re-picking a level is then instant, and
 * — more importantly — undo history holds these objects by reference. Disposing
 * a variant the moment it leaves the scene would leave undo restoring a
 * geometry whose GPU buffers are gone.
 *
 * Memory is bounded at one variant per mesh per level (four), and the whole
 * cache is released when the model is unloaded.
 */
const variants = new Map<string, Map<LevelId, Original>>();

function getVariant(uuid: string, level: LevelId): Original | undefined {
  return variants.get(uuid)?.get(level);
}

function putVariant(uuid: string, level: LevelId, entry: Original) {
  let perMesh = variants.get(uuid);
  if (!perMesh) {
    perMesh = new Map();
    variants.set(uuid, perMesh);
  }
  perMesh.set(level, entry);
}

/** True once a mesh has been optimized away from its original. */
export function isOptimized(mesh: THREE.Mesh): boolean {
  const o = originals.get(mesh.uuid);
  return !!o && o.geometry !== mesh.geometry;
}

function disposeEntry({ geometry, material }: Original) {
  geometry.dispose();
  (Array.isArray(material) ? material : [material]).forEach((m) => {
    if (!m) return;
    for (const slot of TEXTURE_SLOTS) {
      const tex = (m as unknown as Record<string, unknown>)[slot] as THREE.Texture | null;
      // Only textures the app generated (downscaled variants, and roughness maps
      // rebaked from specular-glossiness on load). A texture that came out of the
      // file is shared with the pristine material and released along with it.
      if (tex?.isTexture && tex.userData?.generated) tex.dispose();
    }
    m.dispose();
  });
}

/**
 * Release every cached original and level variant. Safe only once the model is
 * gone from the scene and its history has been discarded.
 */
export function clearOptimizerCache() {
  originals.forEach(disposeEntry);
  originals.clear();
  variants.forEach((perMesh) => perMesh.forEach(disposeEntry));
  variants.clear();
}

/** Put a mesh back to exactly how it was loaded. */
export function restoreOriginal(mesh: THREE.Mesh): boolean {
  const original = originals.get(mesh.uuid);
  if (!original || original.geometry === mesh.geometry) return false;
  // The variant being replaced stays cached — history may still point at it.
  mesh.geometry = original.geometry;
  mesh.material = original.material;
  return true;
}

/** The geometry/material objects a mesh is using right now. */
export function captureMeshState(mesh: THREE.Mesh): Original {
  return { geometry: mesh.geometry, material: mesh.material };
}

// ─── Geometry ─────────────────────────────────────────────────────────────

export function triangleCount(geo: THREE.BufferGeometry): number {
  if (geo.index) return Math.floor(geo.index.count / 3);
  const pos = geo.getAttribute("position");
  return pos ? Math.floor(pos.count / 3) : 0;
}

let simplifierReady: Promise<void> | null = null;

/** The simplifier is WASM; initialise it once, lazily. */
export function ensureSimplifier(): Promise<void> {
  simplifierReady ??= MeshoptSimplifier.ready;
  return simplifierReady;
}

/**
 * Rebuild a geometry from a simplified index buffer, keeping only the vertices
 * the new indices actually reference. meshoptimizer leaves the vertex array
 * untouched, so without this pass the file keeps every original vertex.
 */
function compact(geo: THREE.BufferGeometry, indices: Uint32Array): THREE.BufferGeometry {
  const remap = new Map<number, number>();
  const newIndices = new Uint32Array(indices.length);

  for (let i = 0; i < indices.length; i++) {
    const old = indices[i];
    let next = remap.get(old);
    if (next === undefined) {
      next = remap.size;
      remap.set(old, next);
    }
    newIndices[i] = next;
  }

  const out = new THREE.BufferGeometry();
  for (const name of Object.keys(geo.attributes)) {
    const src = geo.attributes[name] as THREE.BufferAttribute;
    const itemSize = src.itemSize;
    const dst = new Float32Array(remap.size * itemSize);
    remap.forEach((newIndex, oldIndex) => {
      for (let c = 0; c < itemSize; c++) {
        dst[newIndex * itemSize + c] = src.getComponent(oldIndex, c);
      }
    });
    out.setAttribute(name, new THREE.BufferAttribute(dst, itemSize, src.normalized));
  }
  out.setIndex(new THREE.BufferAttribute(newIndices, 1));
  out.name = geo.name;
  return out;
}

/**
 * Why this mesh's geometry must be left alone, or null if it can be decimated.
 *
 * Decimation rewrites the index buffer and drops unreferenced vertices, which
 * silently breaks anything that indexes vertices by position: skinning weights,
 * morph target deltas, and the group ranges that map sub-ranges of the index
 * buffer to entries in a material array.
 *
 * Analysis and application both consult this, so the UI never promises a
 * reduction that the apply step will refuse to make.
 */
export function simplifyBlockReason(
  mesh: THREE.Mesh,
  geo: THREE.BufferGeometry
): string | null {
  if ((mesh as THREE.SkinnedMesh).isSkinnedMesh) return "skinned mesh";
  if (geo.morphAttributes && Object.keys(geo.morphAttributes).length > 0) {
    return "morph targets";
  }
  if (geo.groups && geo.groups.length > 1) return "multi-material groups";
  const position = geo.getAttribute("position");
  if (!position || position.itemSize < 3 || position.count < 3) return "no triangles";
  return null;
}

interface SimplifierInputs {
  indices: Uint32Array;
  positions: Float32Array;
  vertexCount: number;
}

/**
 * Build inputs that satisfy meshoptimizer's preconditions, or null if this
 * geometry cannot produce valid ones. The WASM module asserts hard on malformed
 * input (positions must be a tightly packed Float32Array whose length is a
 * multiple of the stride, index count a multiple of 3), and a thrown assertion
 * from inside the module is not something we can recover the mesh from — so
 * everything is validated here first.
 */
function buildSimplifierInputs(geo: THREE.BufferGeometry): SimplifierInputs | null {
  const position = geo.getAttribute("position");
  if (!position || position.itemSize < 3) return null;

  const vertexCount = position.count;
  if (vertexCount < 3) return null;

  // Copy component-wise rather than reusing `position.array`: the attribute may
  // be interleaved (array holds other attributes too, so its length is not
  // vertexCount * 3) or integer-typed. getX/Y/Z normalises both cases.
  const positions = new Float32Array(vertexCount * 3);
  for (let i = 0; i < vertexCount; i++) {
    const x = position.getX(i);
    const y = position.getY(i);
    const z = position.getZ(i);
    // A NaN or Infinity anywhere makes the simplifier's error metric meaningless.
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return null;
    positions[i * 3] = x;
    positions[i * 3 + 1] = y;
    positions[i * 3 + 2] = z;
  }

  let source: ArrayLike<number>;
  if (geo.index) {
    // index.count, not index.array.length — the buffer can be longer than the
    // range actually in use.
    const index = geo.index;
    const used = new Uint32Array(index.count);
    for (let i = 0; i < index.count; i++) used[i] = index.getX(i);
    source = used;
  } else {
    const seq = new Uint32Array(vertexCount);
    for (let i = 0; i < vertexCount; i++) seq[i] = i;
    source = seq;
  }

  // Must be whole triangles; drop any trailing partial one.
  const usable = Math.floor(source.length / 3) * 3;
  if (usable < 3) return null;
  const indices = new Uint32Array(usable);
  for (let i = 0; i < usable; i++) {
    const idx = source[i];
    // An out-of-range index would read past the vertex buffer inside the WASM.
    if (!Number.isInteger(idx) || idx < 0 || idx >= vertexCount) return null;
    indices[i] = idx;
  }

  return { indices, positions, vertexCount };
}

/** Weld duplicate vertices and decimate to `ratio` of the original triangles. */
export function simplifyGeometry(
  source: THREE.BufferGeometry,
  level: OptimizationLevel,
  mesh: THREE.Mesh
): THREE.BufferGeometry {
  let geo = source.clone();

  // glTF packs attributes interleaved whenever a bufferView declares a
  // byteStride, and mergeVertices cannot handle InterleavedBufferAttribute — it
  // throws, which used to drop us onto the raw interleaved geometry whose
  // position array is vertexCount * stride long, tripping the simplifier's
  // "positions.length % stride === 0" assertion. De-interleaving first fixes the
  // crash and restores welding, which is what makes decimation work well.
  try {
    deinterleaveGeometry(geo);
  } catch (err) {
    console.warn("could not de-interleave geometry attributes", err);
  }

  // Welding is what makes decimation possible at all: split vertices along UV
  // or normal seams look like separate surfaces to the simplifier.
  try {
    geo = mergeVertices(geo);
  } catch (err) {
    console.warn("could not weld geometry; simplifying unwelded", err);
  }

  if (level.triangleRatio >= 1) return geo;
  if (simplifyBlockReason(mesh, geo)) return geo;

  const inputs = buildSimplifierInputs(geo);
  if (!inputs) return geo;
  const { indices, positions } = inputs;

  // Whole triangles, never below one, and never above what we were given —
  // meshoptimizer asserts on all three.
  const targetIndexCount = Math.min(
    indices.length,
    Math.max(3, Math.floor((indices.length * level.triangleRatio) / 3) * 3)
  );
  if (targetIndexCount >= indices.length) return geo;

  let simplified: Uint32Array;
  try {
    if (level.sloppy) {
      // target_error 1 = unconstrained, so the ratio is actually reached even on
      // meshes whose topology would otherwise block reduction.
      [simplified] = MeshoptSimplifier.simplifySloppy(
        indices,
        positions,
        3,
        null,
        targetIndexCount,
        1
      );
    } else {
      [simplified] = MeshoptSimplifier.simplify(
        indices,
        positions,
        3,
        targetIndexCount,
        0.05,
        ["LockBorder"]
      );
    }
  } catch (err) {
    // Last-resort net. The guards above cover the documented preconditions, but
    // a mesh we failed to anticipate must degrade to "not decimated" rather than
    // take the whole optimize run down.
    console.warn("meshoptimizer declined to simplify a geometry; keeping it as-is", err);
    return geo;
  }

  if (!simplified?.length || simplified.length >= indices.length) return geo;

  const compacted = compact(geo, simplified);
  geo.dispose();

  if (level.flatShading) {
    // Faceted shading derives normals per face, so stored normals are dead weight.
    compacted.deleteAttribute("normal");
  } else if (!compacted.getAttribute("normal")) {
    compacted.computeVertexNormals();
  }
  compacted.deleteAttribute("tangent"); // regenerated by the shader when needed
  return compacted;
}

// ─── Textures ─────────────────────────────────────────────────────────────

type DrawableImage = HTMLImageElement | HTMLCanvasElement | ImageBitmap;

function isDrawable(image: unknown): image is DrawableImage {
  if (!image) return false;
  const img = image as { width?: number; height?: number };
  return typeof img.width === "number" && typeof img.height === "number" && img.width > 0;
}

function copyTextureSettings(src: THREE.Texture, dst: THREE.Texture) {
  dst.name = src.name;
  dst.wrapS = src.wrapS;
  dst.wrapT = src.wrapT;
  dst.repeat.copy(src.repeat);
  dst.offset.copy(src.offset);
  dst.center.copy(src.center);
  dst.rotation = src.rotation;
  dst.colorSpace = src.colorSpace;
  dst.flipY = src.flipY;
  dst.channel = src.channel;
  dst.anisotropy = src.anisotropy;
}

/** Downscale a texture to `maxSize` on its longest edge. Returns null if it already fits. */
export function downscaleTexture(
  tex: THREE.Texture,
  maxSize: number,
  jpegQuality: number
): THREE.Texture | null {
  const image = tex.image;
  if (!isDrawable(image)) return null;

  const { width, height } = image;
  if (Math.max(width, height) <= maxSize) return null;

  const scale = maxSize / Math.max(width, height);
  const w = Math.max(1, Math.round(width * scale));
  const h = Math.max(1, Math.round(height * scale));

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(image as CanvasImageSource, 0, 0, w, h);

  const next = new THREE.CanvasTexture(canvas);
  copyTextureSettings(tex, next);
  next.userData.generated = true;
  // GLTFExporter honours userData.mimeType, so this is where the exported byte
  // savings actually come from — PNG re-encodes of photo textures are huge.
  next.userData.mimeType = "image/jpeg";
  next.userData.jpegQuality = jpegQuality;
  next.needsUpdate = true;
  return next;
}

/** Average colour of a texture, used when a level bakes maps down to flat colour. */
export function averageColor(tex: THREE.Texture): THREE.Color | null {
  const image = tex.image;
  if (!isDrawable(image)) return null;
  const canvas = document.createElement("canvas");
  canvas.width = 1;
  canvas.height = 1;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  try {
    ctx.drawImage(image as CanvasImageSource, 0, 0, 1, 1);
    const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
    const color = new THREE.Color();
    // Texture pixels are sRGB; convert so the flat colour matches the original.
    color.setRGB(r / 255, g / 255, b / 255, THREE.SRGBColorSpace);
    return color;
  } catch {
    return null; // tainted canvas (cross-origin texture)
  }
}

// ─── Materials ────────────────────────────────────────────────────────────

function optimizeMaterial(source: THREE.Material, level: OptimizationLevel): THREE.Material {
  const next = source.clone() as THREE.MeshStandardMaterial;
  const record = next as unknown as Record<string, unknown>;

  for (const slot of TEXTURE_SLOTS) {
    const tex = record[slot] as THREE.Texture | null | undefined;
    if (!tex?.isTexture) continue;

    if (level.bakeTexturesToColor && slot === "map") {
      const avg = averageColor(tex);
      if (avg && next.color) next.color.copy(avg);
    }

    if (level.dropMaps.includes(slot)) {
      record[slot] = null;
      continue;
    }

    const smaller = downscaleTexture(tex, level.maxTexture, level.jpegQuality);
    if (smaller) record[slot] = smaller;
  }

  if (level.flatShading) next.flatShading = true;
  if (level.id === "lowpoly") {
    // A low-poly look wants a matte, non-metallic surface.
    next.metalness = Math.min(next.metalness ?? 0, 0.1);
    next.roughness = Math.max(next.roughness ?? 0.5, 0.7);
  }
  next.needsUpdate = true;
  return next;
}

// ─── Analysis ─────────────────────────────────────────────────────────────

export interface MeshAnalysis {
  uuid: string;
  name: string;
  trianglesBefore: number;
  trianglesAfter: number;
  /** Set when this geometry cannot be decimated safely. */
  blocked: string | null;
}

export interface LevelAnalysis {
  level: OptimizationLevel;
  meshCount: number;
  trianglesBefore: number;
  trianglesAfter: number;
  texturesBefore: number;
  texturesResized: number;
  texturesDropped: number;
  /** Meshes whose geometry cannot be decimated (skinned, morphs, groups). */
  blockedMeshes: number;
  /** False when this level would leave the meshes exactly as they are. */
  hasEffect: boolean;
  reason: string | null;
  perMesh: MeshAnalysis[];
}

/**
 * What this level would actually do to these meshes, measured from the real
 * geometry and texture dimensions — never from a guessed compression ratio.
 * Always analysed against the pristine originals, matching what apply does.
 */
export function analyzeLevel(meshes: THREE.Mesh[], level: OptimizationLevel): LevelAnalysis {
  let trianglesBefore = 0;
  let trianglesAfter = 0;
  let texturesResized = 0;
  let texturesDropped = 0;
  let blockedMeshes = 0;
  const seenTextures = new Set<string>();
  const perMesh: MeshAnalysis[] = [];

  for (const mesh of meshes) {
    const source = originals.get(mesh.uuid)?.geometry ?? mesh.geometry;
    if (!source) continue;

    const before = triangleCount(source);
    // A mesh the simplifier will refuse must be reported at its full triangle
    // count, or the level card promises a reduction that never arrives.
    const blocked = simplifyBlockReason(mesh, source);
    if (blocked) blockedMeshes++;
    const after =
      blocked || level.triangleRatio >= 1
        ? before
        : Math.max(1, Math.round(before * level.triangleRatio));
    trianglesBefore += before;
    trianglesAfter += after;
    perMesh.push({
      uuid: mesh.uuid,
      name: mesh.name || "(unnamed)",
      trianglesBefore: before,
      trianglesAfter: after,
      blocked,
    });

    const sourceMat = originals.get(mesh.uuid)?.material ?? mesh.material;
    const mats = Array.isArray(sourceMat) ? sourceMat : [sourceMat];
    for (const mat of mats) {
      if (!mat) continue;
      const record = mat as unknown as Record<string, unknown>;
      for (const slot of TEXTURE_SLOTS) {
        const tex = record[slot] as THREE.Texture | null | undefined;
        if (!tex?.isTexture || seenTextures.has(tex.uuid)) continue;
        seenTextures.add(tex.uuid);

        if (level.dropMaps.includes(slot)) {
          texturesDropped++;
        } else if (isDrawable(tex.image) && Math.max(tex.image.width, tex.image.height) > level.maxTexture) {
          texturesResized++;
        }
      }
    }
  }

  const geometryChanges = trianglesAfter < trianglesBefore;
  const textureChanges = texturesResized > 0 || texturesDropped > 0;
  // Quick can still pay for itself by welding duplicate vertices even when
  // nothing else changes, so it never reports "no effect" on a real mesh.
  const weldChances = level.id === "quick" && trianglesBefore > 0;
  const hasEffect = geometryChanges || textureChanges || level.flatShading || weldChances;

  let reason: string | null = null;
  if (meshes.length === 0) reason = "No meshes to optimize";
  else if (!hasEffect) reason = "Already at or below this level";

  return {
    level,
    meshCount: meshes.length,
    trianglesBefore,
    trianglesAfter,
    texturesBefore: seenTextures.size,
    texturesResized,
    texturesDropped,
    blockedMeshes,
    hasEffect: hasEffect && meshes.length > 0,
    reason,
    perMesh,
  };
}

// ─── Apply ────────────────────────────────────────────────────────────────

export interface OptimizeResult {
  meshCount: number;
  trianglesBefore: number;
  trianglesAfter: number;
  texturesChanged: number;
  /** Meshes left untouched because optimizing them would have broken them. */
  skipped: number;
}

/**
 * Apply a level to the given meshes, in place. Always derived from each mesh's
 * pristine original, so switching levels re-derives rather than compounds.
 * `onProgress` is awaited between meshes so the UI can paint.
 */
export async function applyLevel(
  meshes: THREE.Mesh[],
  level: OptimizationLevel,
  onProgress?: (done: number, total: number) => void
): Promise<OptimizeResult> {
  await ensureSimplifier();

  let trianglesBefore = 0;
  let trianglesAfter = 0;
  let texturesChanged = 0;
  let skipped = 0;

  for (let i = 0; i < meshes.length; i++) {
    const mesh = meshes[i];
    try {
      const original = rememberOriginal(mesh);
      if (!original.geometry) continue;

      trianglesBefore += triangleCount(original.geometry);

      // Reuse this mesh's cached result for the level if we already built it.
      let variant = getVariant(mesh.uuid, level.id);
      if (!variant) {
        const nextGeometry = simplifyGeometry(original.geometry, level, mesh);
        const nextMaterial = Array.isArray(original.material)
          ? original.material.map((m) => optimizeMaterial(m, level))
          : optimizeMaterial(original.material, level);
        variant = { geometry: nextGeometry, material: nextMaterial };
        putVariant(mesh.uuid, level.id, variant);
      }

      const originalMats = Array.isArray(original.material)
        ? original.material
        : [original.material];
      texturesChanged += countChangedTextures(
        originalMats,
        Array.isArray(variant.material) ? variant.material : [variant.material]
      );

      // The outgoing geometry/material stays cached — undo history points at it.
      mesh.geometry = variant.geometry;
      mesh.material = variant.material;
      trianglesAfter += triangleCount(variant.geometry);
    } catch (err) {
      // One awkward mesh must not abort the run or leave the model half-applied.
      console.warn("Skipped optimizing mesh " + (mesh.name || mesh.uuid), err);
      skipped++;
      trianglesAfter += triangleCount(mesh.geometry);
    }

    onProgress?.(i + 1, meshes.length);
    // Yield so a large model doesn't lock the main thread solid.
    if (i % 4 === 3) await new Promise((r) => setTimeout(r, 0));
  }

  return { meshCount: meshes.length, trianglesBefore, trianglesAfter, texturesChanged, skipped };
}

function countChangedTextures(before: THREE.Material[], after: THREE.Material[]): number {
  let changed = 0;
  for (let i = 0; i < after.length; i++) {
    const a = before[i] as unknown as Record<string, unknown> | undefined;
    const b = after[i] as unknown as Record<string, unknown>;
    if (!a) continue;
    for (const slot of TEXTURE_SLOTS) {
      if (a[slot] !== b[slot]) changed++;
    }
  }
  return changed;
}
