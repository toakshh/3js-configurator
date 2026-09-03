import * as THREE from "three";
import { MaterialSnapshot } from "@/store/glbStore";

export function colorToHex(c: THREE.Color): string {
  return "#" + c.getHexString();
}

export function hexToColor(hex: string): THREE.Color {
  return new THREE.Color(hex);
}

export function snapshotMaterial(mat: THREE.Material): MaterialSnapshot {
  const m = mat as THREE.MeshStandardMaterial & THREE.MeshPhysicalMaterial;
  return {
    color: m.color ? m.color.getHex() : 0xffffff,
    roughness: m.roughness ?? 0.5,
    metalness: m.metalness ?? 0,
    emissive: m.emissive ? m.emissive.getHex() : 0,
    emissiveIntensity: m.emissiveIntensity ?? 1,
    opacity: m.opacity ?? 1,
    transparent: m.transparent ?? false,
    wireframe: m.wireframe ?? false,
    flatShading: m.flatShading ?? false,
    side: m.side ?? THREE.FrontSide,
    envMapIntensity: m.envMapIntensity ?? 1,
    clearcoat: m.clearcoat ?? 0,
    clearcoatRoughness: m.clearcoatRoughness ?? 0,
    transmission: m.transmission ?? 0,
    thickness: m.thickness ?? 0,
    sheen: m.sheen ?? 0,
    sheenRoughness: m.sheenRoughness ?? 1,
    iridescence: m.iridescence ?? 0,
    depthWrite: m.depthWrite !== false,
    blending: m.blending ?? THREE.NormalBlending,
  };
}

export function applySnapshot(mat: THREE.MeshStandardMaterial, snap: MaterialSnapshot) {
  if (mat.color) mat.color.set(snap.color);
  mat.roughness = snap.roughness;
  mat.metalness = snap.metalness;
  if (mat.emissive) mat.emissive.set(snap.emissive);
  mat.emissiveIntensity = snap.emissiveIntensity;
  mat.opacity = snap.opacity;
  mat.transparent = snap.transparent;
  mat.wireframe = snap.wireframe;
  mat.flatShading = snap.flatShading;
  mat.side = snap.side;
  mat.depthWrite = snap.depthWrite;
  mat.blending = snap.blending;
  if ("envMapIntensity" in mat) mat.envMapIntensity = snap.envMapIntensity;
  mat.needsUpdate = true;
}

export function getMeshMat(mesh: THREE.Mesh): THREE.MeshStandardMaterial | null {
  const m = mesh.material;
  if (!m) return null;
  return (Array.isArray(m) ? m[0] : m) as THREE.MeshStandardMaterial;
}

export function setAllMats(
  mesh: THREE.Mesh,
  fn: (mat: THREE.MeshStandardMaterial) => void
) {
  const mats = Array.isArray(mesh.material)
    ? mesh.material
    : [mesh.material];
  mats.forEach((m) => {
    fn(m as THREE.MeshStandardMaterial);
    (m as THREE.Material).needsUpdate = true;
  });
}

/** Get a data-URL thumbnail of a Three.js Texture (128x128) */
export function textureToDataURL(tex: THREE.Texture, size = 80): string | null {
  try {
    const img = tex.image as HTMLImageElement | HTMLCanvasElement | ImageBitmap | null;
    if (!img) return null;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(img as CanvasImageSource, 0, 0, size, size);
    return canvas.toDataURL("image/png");
  } catch {
    return null;
  }
}
