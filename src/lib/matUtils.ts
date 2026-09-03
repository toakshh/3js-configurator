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
  };
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
