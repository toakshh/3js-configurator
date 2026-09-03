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
  depthWrite: boolean;
  blending: THREE.Blending;
}

// A single undo/redo step: map of uuid → MaterialSnapshot
export type HistoryStep = Map<string, MaterialSnapshot>;

export type EnvMode = "studio" | "outdoor" | "dark" | "none";
export type ActiveTab = "material" | "transform" | "info";

interface GLBStore {
  scene: THREE.Scene | null;
  gltfRoot: THREE.Group | null;

  meshEntries: MeshEntry[];
  // primary selected uuid (for right-panel display)
  selectedUUID: string | null;
  // all selected uuids (for multi-select)
  selectedUUIDs: Set<string>;

  activeTab: ActiveTab;
  searchQuery: string;
  globalWireframe: boolean;
  showGrid: boolean;
  envMode: EnvMode;
  skybox: boolean;
  cameraMode: "perspective" | "ortho";

  // original snapshots (for "reset all")
  snapshots: Map<string, MaterialSnapshot>;

  // undo/redo
  history: HistoryStep[];
  historyIndex: number; // points to current state in history

  // actions
  setScene: (scene: THREE.Scene) => void;
  setGltfRoot: (root: THREE.Group | null) => void;
  setMeshEntries: (entries: MeshEntry[]) => void;

  // single select (replaces selection)
  selectMesh: (uuid: string | null) => void;
  // add/remove from multi-select
  toggleMeshSelection: (uuid: string) => void;
  // range-select up to uuid
  rangeSelectMesh: (uuid: string) => void;
  clearSelection: () => void;
  removeMesh: (uuid: string) => void;

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

  // history
  pushHistory: (step: HistoryStep) => void;
  undo: () => HistoryStep | null;
  redo: () => HistoryStep | null;
}

const MAX_HISTORY = 50;

export const useGLBStore = create<GLBStore>((set, get) => ({
  scene: null,
  gltfRoot: null,
  meshEntries: [],
  selectedUUID: null,
  selectedUUIDs: new Set(),
  activeTab: "material",
  searchQuery: "",
  globalWireframe: false,
  showGrid: true,
  envMode: "studio",
  skybox: false,
  cameraMode: "perspective",
  snapshots: new Map(),
  history: [],
  historyIndex: -1,

  setScene: (scene) => set({ scene }),
  setGltfRoot: (gltfRoot) => set({ gltfRoot }),
  setMeshEntries: (meshEntries) => set({ meshEntries }),

  selectMesh: (uuid) =>
    set({
      selectedUUID: uuid,
      selectedUUIDs: uuid ? new Set([uuid]) : new Set(),
    }),

  toggleMeshSelection: (uuid) =>
    set((state) => {
      const next = new Set(state.selectedUUIDs);
      if (next.has(uuid)) {
        next.delete(uuid);
        // update primary to last remaining or null
        const arr = [...next];
        return { selectedUUIDs: next, selectedUUID: arr[arr.length - 1] ?? null };
      } else {
        next.add(uuid);
        return { selectedUUIDs: next, selectedUUID: uuid };
      }
    }),

  rangeSelectMesh: (uuid) =>
    set((state) => {
      const entries = state.meshEntries;
      const anchorUUID = state.selectedUUID;
      if (!anchorUUID) {
        return { selectedUUIDs: new Set([uuid]), selectedUUID: uuid };
      }
      const anchorIdx = entries.findIndex((e) => e.uuid === anchorUUID);
      const targetIdx = entries.findIndex((e) => e.uuid === uuid);
      if (anchorIdx === -1 || targetIdx === -1) return {};
      const lo = Math.min(anchorIdx, targetIdx);
      const hi = Math.max(anchorIdx, targetIdx);
      const next = new Set(state.selectedUUIDs);
      for (let i = lo; i <= hi; i++) next.add(entries[i].uuid);
      return { selectedUUIDs: next, selectedUUID: uuid };
    }),

  clearSelection: () => set({ selectedUUID: null, selectedUUIDs: new Set() }),

  removeMesh: (uuid) => 
    set((state) => {
      const nextMeshEntries = state.meshEntries.filter(m => m.uuid !== uuid);
      const nextSelected = new Set(state.selectedUUIDs);
      nextSelected.delete(uuid);
      const nextPrimary = state.selectedUUID === uuid ? null : state.selectedUUID;
      return {
        meshEntries: nextMeshEntries,
        selectedUUIDs: nextSelected,
        selectedUUID: nextPrimary
      };
    }),

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
      selectedUUIDs: new Set(),
      snapshots: new Map(),
      globalWireframe: false,
      history: [],
      historyIndex: -1,
    }),

  pushHistory: (step) =>
    set((state) => {
      // truncate any redo future
      const truncated = state.history.slice(0, state.historyIndex + 1);
      const next = [...truncated, step];
      // cap at MAX_HISTORY
      if (next.length > MAX_HISTORY) next.shift();
      return { history: next, historyIndex: next.length - 1 };
    }),

  undo: () => {
    const state = get();
    if (state.historyIndex <= 0) return null;
    const newIndex = state.historyIndex - 1;
    set({ historyIndex: newIndex });
    return state.history[newIndex];
  },

  redo: () => {
    const state = get();
    if (state.historyIndex >= state.history.length - 1) return null;
    const newIndex = state.historyIndex + 1;
    set({ historyIndex: newIndex });
    return state.history[newIndex];
  },
}));
