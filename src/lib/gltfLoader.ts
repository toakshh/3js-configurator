/**
 * A GLTFLoader that can actually open the files people have.
 *
 * A bare `new GLTFLoader()` handles only a subset of what is out in the wild.
 * Two gaps account for most "it loaded but it is wrong" reports:
 *
 *  - **Compression.** Draco geometry, KTX2/Basis textures and meshopt buffers
 *    all need a decoder registered up front. Without one the loader throws and
 *    the file is simply rejected.
 *  - **Specular-glossiness.** `KHR_materials_pbrSpecularGlossiness` was the
 *    common PBR workflow for years and is what most older Sketchfab, Substance
 *    and Blender-2.x exports carry. Three.js dropped support for it, and an
 *    unrecognised material extension does not fail loudly — the loader falls
 *    back to the file's `pbrMetallicRoughness` block, which a spec-gloss export
 *    does not have. The result is a default material: white, metalness 1,
 *    roughness 1, no texture. The geometry looks perfect and the model renders
 *    as a blank white statue.
 *
 * This module closes both, and reports what it had to do so nothing is silently
 * approximated.
 */

import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/examples/jsm/loaders/DRACOLoader.js";
import { KTX2Loader } from "three/examples/jsm/loaders/KTX2Loader.js";
import type { GLTF, GLTFParser } from "three/examples/jsm/loaders/GLTFLoader.js";

const SPEC_GLOSS = "KHR_materials_pbrSpecularGlossiness";

/** What had to be worked around while opening a file. */
export interface LoadReport {
  /** Materials converted from specular-glossiness to metallic-roughness. */
  specGlossConverted: number;
  /** Glossiness maps rebaked into roughness maps. */
  glossMapsBaked: number;
  /** Extensions the file uses that nothing here understands. */
  unsupportedExtensions: string[];
  /** Materials that ended up with no base colour texture in a textured file. */
  untexturedMaterials: number;
}

// Decoders are shared: each one spins up workers and a WASM module, and there
// is no reason for a second model to pay that cost again.
let draco: DRACOLoader | null = null;
let ktx2: KTX2Loader | null = null;

function getDraco(): DRACOLoader {
  if (!draco) {
    draco = new DRACOLoader();
    draco.setDecoderPath("/decoders/draco/");
  }
  return draco;
}

function getKTX2(renderer: THREE.WebGLRenderer): KTX2Loader {
  if (!ktx2) {
    ktx2 = new KTX2Loader();
    ktx2.setTranscoderPath("/decoders/basis/");
  }
  // Which compressed formats can be transcoded to depends on the GPU, so the
  // loader has to be told about the renderer before it can decide.
  ktx2.detectSupport(renderer);
  return ktx2;
}

/** Release the shared decoders and their workers. */
export function disposeDecoders() {
  draco?.dispose();
  ktx2?.dispose();
  draco = null;
  ktx2 = null;
}

/** Resolved once and reused; the module is a sizeable WASM blob. */
let meshoptPromise: Promise<unknown> | null = null;

async function getMeshopt(): Promise<unknown | null> {
  if (!meshoptPromise) {
    meshoptPromise = import("three/examples/jsm/libs/meshopt_decoder.module.js")
      .then(async (m) => {
        await m.MeshoptDecoder.ready;
        return m.MeshoptDecoder;
      })
      .catch((err) => {
        console.warn("meshopt decoder unavailable; EXT_meshopt_compression files will not open", err);
        return null;
      });
  }
  return meshoptPromise as Promise<unknown | null>;
}

/**
 * A loader wired for compressed geometry and textures.
 *
 * The decoders are attached before the loader is handed back rather than
 * racing the first file, so a meshopt model opened one second after startup
 * behaves the same as one opened ten minutes in.
 */
export async function createGLTFLoader(
  renderer: THREE.WebGLRenderer | null
): Promise<GLTFLoader> {
  const loader = new GLTFLoader();
  loader.setDRACOLoader(getDraco());
  if (renderer) loader.setKTX2Loader(getKTX2(renderer));
  const meshopt = await getMeshopt();
  if (meshopt) loader.setMeshoptDecoder(meshopt as Parameters<GLTFLoader["setMeshoptDecoder"]>[0]);
  return loader;
}

// ─── specular-glossiness → metallic-roughness ─────────────────────────────

interface SpecGlossDef {
  diffuseFactor?: number[];
  diffuseTexture?: { index: number; texCoord?: number };
  specularFactor?: number[];
  glossinessFactor?: number;
  specularGlossinessTexture?: { index: number; texCoord?: number };
}

/** Materials in the parsed scene, paired with their index in the glTF JSON. */
function materialsWithIndex(
  root: THREE.Object3D,
  parser: GLTFParser
): { material: THREE.Material; index: number }[] {
  const out: { material: THREE.Material; index: number }[] = [];
  const seen = new Set<THREE.Material>();

  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.material) return;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const material of mats) {
      if (seen.has(material)) continue;
      seen.add(material);
      // `associations` is how the parser records which glTF definition each
      // object came from — the supported way back to the source JSON.
      const link = parser.associations.get(material) as { materials?: number } | undefined;
      if (link?.materials === undefined) continue;
      out.push({ material, index: link.materials });
    }
  });

  return out;
}

/**
 * Rebake a specular-glossiness texture into a roughness map.
 *
 * glTF stores glossiness in the texture's **alpha** channel, and Three.js reads
 * roughness from the **green** channel of `roughnessMap`. So the alpha is
 * inverted (roughness = 1 − glossiness) and written into green. Without this
 * the whole model would take a single flat roughness value and lose the
 * distinction between, say, skin and a metal buckle.
 *
 * Returns null when the image cannot be read back — a compressed texture, or a
 * source the canvas refuses — in which case the caller keeps the scalar.
 */
function bakeGlossToRoughness(source: THREE.Texture): THREE.Texture | null {
  try {
    const img = source.image as HTMLImageElement | HTMLCanvasElement | ImageBitmap | undefined;
    const w = (img as { width?: number })?.width ?? 0;
    const h = (img as { height?: number })?.height ?? 0;
    if (!img || !w || !h) return null;

    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return null;

    ctx.drawImage(img as CanvasImageSource, 0, 0);
    const data = ctx.getImageData(0, 0, w, h);
    const px = data.data;
    for (let i = 0; i < px.length; i += 4) {
      const roughness = 255 - px[i + 3];
      px[i] = 0; // red unused
      px[i + 1] = roughness; // green = roughness
      px[i + 2] = 0; // blue = metalness, left at zero
      px[i + 3] = 255;
    }
    ctx.putImageData(data, 0, 0);

    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = source.wrapS;
    tex.wrapT = source.wrapT;
    tex.flipY = false;
    tex.channel = source.channel;
    tex.colorSpace = THREE.NoColorSpace;
    // `generated` is the shared marker for "not one of the file's own textures,
    // so it can be freed along with the material that holds it" — the optimizer
    // reads the same flag when clearing its cache.
    tex.userData.generated = true;
    tex.userData.source = "specgloss-roughness";
    tex.needsUpdate = true;
    return tex;
  } catch (err) {
    console.warn("could not rebake a glossiness map; using a flat roughness instead", err);
    return null;
  }
}

/**
 * Convert every specular-glossiness material in the scene, in place.
 *
 * The conversion keeps what carries the model's appearance — the diffuse colour
 * and its texture — and approximates the rest. Metalness is set to zero because
 * a spec-gloss material has no metalness channel to read; almost everything
 * authored in that workflow is dielectric, and a wrong metalness of 1 is what
 * makes a model look like a chrome blob.
 */
async function convertSpecularGlossiness(gltf: GLTF, report: LoadReport): Promise<void> {
  const parser = gltf.parser;
  const json = parser.json as { materials?: { extensions?: Record<string, SpecGlossDef> }[] };
  if (!json.materials?.length) return;

  for (const { material, index } of materialsWithIndex(gltf.scene, parser)) {
    const ext = json.materials[index]?.extensions?.[SPEC_GLOSS];
    if (!ext) continue;

    const std = material as THREE.MeshStandardMaterial;
    if (!std.isMeshStandardMaterial) continue;

    const diffuse = ext.diffuseFactor;
    if (diffuse) {
      // Factors are linear in glTF; setRGB defaults to the working space, so
      // state it explicitly rather than letting it be re-interpreted as sRGB.
      std.color.setRGB(diffuse[0], diffuse[1], diffuse[2], THREE.LinearSRGBColorSpace);
      if (diffuse[3] !== undefined && diffuse[3] < 1) {
        std.opacity = diffuse[3];
        std.transparent = true;
      }
    } else {
      std.color.setRGB(1, 1, 1, THREE.LinearSRGBColorSpace);
    }

    // Metalness has no equivalent in this workflow, and the default of 1 that
    // the failed parse left behind is the worst possible guess.
    std.metalness = 0;
    std.roughness = 1 - (ext.glossinessFactor ?? 1);

    const params: Record<string, THREE.Texture> = {};
    if (ext.diffuseTexture) {
      await parser.assignTexture(params, "map", ext.diffuseTexture, THREE.SRGBColorSpace);
      if (params.map) std.map = params.map;
    }

    if (ext.specularGlossinessTexture) {
      await parser.assignTexture(params, "glossMap", ext.specularGlossinessTexture);
      const baked = params.glossMap ? bakeGlossToRoughness(params.glossMap) : null;
      if (baked) {
        std.roughnessMap = baked;
        // The map now carries the variation, so the scalar must not scale it down.
        std.roughness = 1;
        report.glossMapsBaked++;
      }
    }

    std.needsUpdate = true;
    report.specGlossConverted++;
  }
}

// ─── loading ──────────────────────────────────────────────────────────────

const KNOWN_EXTENSIONS = new Set([
  "KHR_draco_mesh_compression",
  "KHR_texture_basisu",
  "EXT_meshopt_compression",
  "KHR_materials_unlit",
  "KHR_materials_clearcoat",
  "KHR_materials_dispersion",
  "KHR_materials_ior",
  "KHR_materials_sheen",
  "KHR_materials_specular",
  "KHR_materials_transmission",
  "KHR_materials_iridescence",
  "KHR_materials_anisotropy",
  "KHR_materials_volume",
  "KHR_materials_emissive_strength",
  "KHR_texture_transform",
  "KHR_mesh_quantization",
  "KHR_lights_punctual",
  "KHR_materials_variants",
  "EXT_materials_bump",
  "EXT_texture_webp",
  "EXT_texture_avif",
  "EXT_mesh_gpu_instancing",
  SPEC_GLOSS,
]);

/** Count materials that show no base colour map in a file that ships images. */
function countUntextured(root: THREE.Object3D, parser: GLTFParser): number {
  const json = parser.json as { images?: unknown[] };
  if (!json.images?.length) return 0;
  let n = 0;
  const seen = new Set<THREE.Material>();
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.material) return;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const m of mats) {
      if (seen.has(m)) continue;
      seen.add(m);
      if (!(m as THREE.MeshStandardMaterial).map) n++;
    }
  });
  return n;
}

/**
 * Parse a .glb/.gltf, repairing what Three.js alone would get wrong.
 *
 * Resolves with the parsed result plus a report of every approximation made, so
 * the caller can tell the user rather than leaving them to wonder why their
 * model is white.
 */
export async function loadGLTF(
  url: string,
  renderer: THREE.WebGLRenderer | null
): Promise<{ gltf: GLTF; report: LoadReport }> {
  const loader = await createGLTFLoader(renderer);
  return new Promise((resolve, reject) => {
    loader.load(
      url,
      async (gltf) => {
        const report: LoadReport = {
          specGlossConverted: 0,
          glossMapsBaked: 0,
          unsupportedExtensions: [],
          untexturedMaterials: 0,
        };
        try {
          await convertSpecularGlossiness(gltf, report);

          const json = gltf.parser.json as { extensionsUsed?: string[] };
          report.unsupportedExtensions = (json.extensionsUsed ?? []).filter(
            (e) => !KNOWN_EXTENSIONS.has(e)
          );
          report.untexturedMaterials = countUntextured(gltf.scene, gltf.parser);
        } catch (err) {
          // A repair that fails must not cost the user the whole model.
          console.warn("material repair pass failed; loading the model as parsed", err);
        }
        resolve({ gltf, report });
      },
      undefined,
      (err) => reject(err)
    );
  });
}
