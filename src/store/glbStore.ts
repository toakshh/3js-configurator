import { create } from "zustand";
import * as THREE from "three";

export interface MeshEntry {
  uuid: string;
  name: string;
  mesh: THREE.Mesh;
  visible: boolean;
  vertexCount: number;
  faceCount: number;
  hasUV: boolean;
  hasNormals: boolean;
  hasVertexColor: boolean;
  materialType: string;
}

export interface MaterialSnapshot {
  color: number;
  roughness: number;
  metalness: number;
  emissive: number;
  emissiveIntensity: number;
  opacity: number;
  transparent: boolean;
  wireframe: boolean;
  flatShading: boolean;
  side: THREE.Side;
  envMapIntensity: number;
  clearcoat: number;
  clearcoatRoughness: number;
  transmission: number;
  thickness: number;
  sheen: number;
  sheenRoughness: number;
  iridescence: number;
}

export type EnvMode = "studio" | "outdoor" | "dark" | "none";
export type ActiveTab = "material" | "transform" | "info";

interface GLBStore {
  // scene refs (set imperatively, not serialized)
  scene: THREE.Scene | null;
  gltfRoot: THREE.Group | null;

  // mesh list
  meshEntries: MeshEntry[];
  selectedUUID: string | null;

  // ui
  activeTab: ActiveTab;
  searchQuery: string;
  globalWireframe: boolean;
  showGrid: boolean;
  envMode: EnvMode;
  skybox: boolean;
  cameraMode: "perspective" | "ortho";

  // material snapshots for reset
  snapshots: Map<string, MaterialSnapshot>;

  // actions
  setScene: (scene: THREE.Scene) => void;
  setGltfRoot: (root: THREE.Group | null) => void;
  setMeshEntries: (entries: MeshEntry[]) => void;
  selectMesh: (uuid: string | null) => void;
  setActiveTab: (tab: ActiveTab) => void;
  setSearchQuery: (q: string) => void;
  setGlobalWireframe: (v: boolean) => void;
  setShowGrid: (v: boolean) => void;
  setEnvMode: (m: EnvMode) => void;
  setSkybox: (v: boolean) => void;
  setCameraMode: (m: "perspective" | "ortho") => void;
  setSnapshot: (uuid: string, snap: MaterialSnapshot) => void;
  updateMeshVisibility: (uuid: string, visible: boolean) => void;
  clearAll: () => void;
}

export const useGLBStore = create<GLBStore>((set) => ({
  scene: null,
  gltfRoot: null,
  meshEntries: [],
  selectedUUID: null,
  activeTab: "material",
  searchQuery: "",
  globalWireframe: false,
  showGrid: true,
  envMode: "studio",
  skybox: false,
  cameraMode: "perspective",
  snapshots: new Map(),

  setScene: (scene) => set({ scene }),
  setGltfRoot: (gltfRoot) => set({ gltfRoot }),
  setMeshEntries: (meshEntries) => set({ meshEntries }),
  selectMesh: (selectedUUID) => set({ selectedUUID }),
  setActiveTab: (activeTab) => set({ activeTab }),
  setSearchQuery: (searchQuery) => set({ searchQuery }),
  setGlobalWireframe: (globalWireframe) => set({ globalWireframe }),
  setShowGrid: (showGrid) => set({ showGrid }),
  setEnvMode: (envMode) => set({ envMode }),
  setSkybox: (skybox) => set({ skybox }),
  setCameraMode: (cameraMode) => set({ cameraMode }),
  setSnapshot: (uuid, snap) =>
    set((state) => {
      const next = new Map(state.snapshots);
      next.set(uuid, snap);
      return { snapshots: next };
    }),
  updateMeshVisibility: (uuid, visible) =>
    set((state) => ({
      meshEntries: state.meshEntries.map((e) =>
        e.uuid === uuid ? { ...e, visible } : e
      ),
    })),
  clearAll: () =>
    set({
      gltfRoot: null,
      meshEntries: [],
      selectedUUID: null,
      snapshots: new Map(),
      globalWireframe: false,
    }),
}));
