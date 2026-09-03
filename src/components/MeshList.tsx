"use client";

import { memo, useCallback, useMemo } from "react";
import * as THREE from "three";
import { useGLBStore, MeshEntry } from "@/store/glbStore";
import { ViewportRefs, getMesh, deleteMeshFromViewport } from "@/hooks/useViewport";
import { toast } from "react-hot-toast";
import { Trash2, Eye, EyeOff, Box } from "lucide-react";

function MeshRow({
  entry,
  isSelected,
  isPrimary,
  isWire,
  onSelect,
  onToggleVis,
  onToggleWire,
  onDelete,
}: {
  entry: MeshEntry;
  isSelected: boolean;
  isPrimary: boolean;
  isWire: boolean;
  onSelect: (uuid: string, e: React.MouseEvent) => void;
  onToggleVis: (uuid: string, current: boolean, e: React.MouseEvent) => void;
  onToggleWire: (uuid: string, e: React.MouseEvent) => void;
  onDelete: (uuid: string, e: React.MouseEvent) => void;
}) {
  return (
    <div
      onClick={(e) => onSelect(entry.uuid, e)}
      className={`flex items-center gap-2 px-3 py-2 rounded-lg mb-1 cursor-pointer border transition-all group select-none
        ${isSelected
          ? isPrimary
            ? "bg-[#5b6ef5]/20 border-[#5b6ef5]"
            : "bg-[#5b6ef5]/10 border-[#5b6ef5]/50"
          : "bg-transparent border-transparent hover:bg-[#1e2235]"
        }`}
    >
      {/* Selection indicator */}
      <span
        className={`w-1.5 h-1.5 rounded-full flex-shrink-0 transition-colors ${
          isPrimary ? "bg-[#7c8bff]" : isSelected ? "bg-[#5b6ef5]/60" : "bg-transparent"
        }`}
      />
      <span className="text-[13px] flex-shrink-0 opacity-50">⬡</span>
      <span
        className={`flex-1 text-[12px] truncate ${
          isPrimary ? "text-[#7c8bff]" : isSelected ? "text-[#a0a8ff]" : "text-[#ccd]"
        }`}
        title={entry.name}
      >
        {entry.name}
      </span>

      {/* Visibility toggle */}
      <button
        onClick={(e) => onToggleVis(entry.uuid, entry.visible, e)}
        className={`p-1 rounded transition-opacity flex-shrink-0
          ${entry.visible ? "opacity-0 group-hover:opacity-70 hover:!opacity-100 text-[#7c8bff]" : "opacity-100 text-[#f5a623]"}
          hover:bg-[#5b6ef5]/10`}
        title={entry.visible ? "Hide mesh" : "Show mesh"}
      >
        {entry.visible ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
      </button>

      {/* Per-mesh wireframe toggle */}
      <button
        onClick={(e) => onToggleWire(entry.uuid, e)}
        className={`p-1 rounded transition-opacity flex-shrink-0
          ${isWire ? "text-[#7c8bff]" : "text-[#3a4270]"}
          hover:bg-[#5b6ef5]/10`}
        title={isWire ? "Disable wireframe" : "Enable wireframe"}
      >
        <Box className="w-4 h-4" />
      </button>

      {/* Vertex count */}
      <span className="text-[9px] text-[#445] flex-shrink-0 bg-[#1a1d27] px-1.5 py-0.5 rounded">
        {entry.vertexCount}v
      </span>

      {/* Delete button */}
      <button
        onClick={(e) => onDelete(entry.uuid, e)}
        className="p-1 rounded transition-opacity flex-shrink-0 opacity-0 group-hover:opacity-100
          text-[#ff6b6b] hover:bg-[#ff6b6b]/10 hover:text-white"
        title="Delete mesh"
      >
        <Trash2 className="w-4 h-4" />
      </button>
    </div>
  );
}

// Rows only re-render when their own props change, so selecting one mesh in a
// 500-mesh model repaints two rows instead of all of them.
const MemoMeshRow = memo(MeshRow);

export default function MeshList({ vpRefs }: { vpRefs: React.MutableRefObject<ViewportRefs> }) {
  const meshEntries = useGLBStore((s) => s.meshEntries);
  const searchQuery = useGLBStore((s) => s.searchQuery);
  const selectedUUIDs = useGLBStore((s) => s.selectedUUIDs);
  const selectedUUID = useGLBStore((s) => s.selectedUUID);
  const globalWireframe = useGLBStore((s) => s.globalWireframe);
  // Per-mesh wireframe lives on the Three.js material, not in the store.
  const revision = useGLBStore((s) => s.revision);

  const setGlobalWireframe = useGLBStore((s) => s.setGlobalWireframe);
  const bumpRevision = useGLBStore((s) => s.bumpRevision);

  const filtered = useMemo(() => {
    const q = searchQuery.toLowerCase();
    return q ? meshEntries.filter((e) => e.name.toLowerCase().includes(q)) : meshEntries;
  }, [meshEntries, searchQuery]);

  const isWireframe = useCallback(
    (uuid: string) => {
      const mesh = getMesh(vpRefs.current, uuid);
      if (!mesh?.material) return false;
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      return mats.some((m) => (m as THREE.MeshStandardMaterial).wireframe);
    },
    // revision is the signal that a material was mutated in place
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [vpRefs, revision]
  );

  const handleSelect = useCallback((uuid: string, e: React.MouseEvent) => {
    const store = useGLBStore.getState();
    if (e.ctrlKey || e.metaKey) {
      store.toggleMeshSelection(uuid);
    } else if (e.shiftKey) {
      store.rangeSelectMesh(uuid);
    } else {
      store.selectMesh(uuid);
    }
  }, []);

  const toggleVis = useCallback(
    (uuid: string, current: boolean, e: React.MouseEvent) => {
      e.stopPropagation();
      const mesh = getMesh(vpRefs.current, uuid);
      if (mesh) mesh.visible = !current;
      useGLBStore.getState().updateMeshVisibility(uuid, !current);
    },
    [vpRefs]
  );

  const toggleWire = useCallback(
    (uuid: string, e: React.MouseEvent) => {
      e.stopPropagation();
      const mesh = getMesh(vpRefs.current, uuid);
      if (!mesh?.material) return;
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      const next = !mats.some((m) => (m as THREE.MeshStandardMaterial).wireframe);
      mats.forEach((m) => {
        (m as THREE.MeshStandardMaterial).wireframe = next;
      });
      bumpRevision();
    },
    [vpRefs, bumpRevision]
  );

  const confirmDelete = useCallback(
    (uuid: string, e: React.MouseEvent) => {
      e.stopPropagation();
      const store = useGLBStore.getState();
      const entry = store.meshEntries.find((m) => m.uuid === uuid);
      if (!entry) return;

      toast.dismiss();
      const confirmed = window.confirm(
        `Delete "${entry.name}" (${entry.vertexCount.toLocaleString()} verts, ${entry.faceCount.toLocaleString()} tris)?\n\nThis action cannot be undone.`
      );
      if (!confirmed) return;

      // Removes it from the scene, the uuid/raycast tables and the GPU.
      deleteMeshFromViewport(uuid, vpRefs.current);
      store.removeMesh(uuid);
      toast.success(`Deleted "${entry.name}"`);
    },
    [vpRefs]
  );

  if (meshEntries.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-[#445] text-xs p-4 text-center">
        Load a .glb file to see its meshes
      </div>
    );
  }

  const selCount = selectedUUIDs.size;

  return (
    <div className="flex-1 overflow-y-auto px-2 pb-2 scrollbar-thin">
      {/* Header with global wireframe toggle */}
      <div className="flex items-center justify-between px-2 py-2 border-b border-[#1e2440]">
        <div className="flex items-center gap-2">
          <p className="text-[10px] text-[#556] uppercase tracking-widest">
            Meshes ({filtered.length})
          </p>
          {selCount > 1 && (
            <span className="text-[9px] bg-[#5b6ef5]/20 text-[#7c8bff] border border-[#5b6ef5]/40 px-1.5 py-0.5 rounded-full">
              {selCount} selected
            </span>
          )}
        </div>
        {/* Global wireframe toggle */}
        <label className="flex items-center gap-1.5 cursor-pointer group">
          <input
            type="checkbox"
            checked={globalWireframe}
            onChange={() => setGlobalWireframe(!globalWireframe)}
            className="sr-only peer"
          />
          <span className="w-5 h-5 rounded border border-[#2e3660] bg-[#12152a] flex items-center justify-center transition-all peer-checked:bg-[#5b6ef5] peer-checked:border-[#5b6ef5]">
            <Box className="w-3 h-3 text-[#3a4270] peer-checked:text-white" />
          </span>
          <span className="text-[10px] text-[#3a4270] peer-checked:text-[#7c8bff]">
            Wire
          </span>
        </label>
      </div>

      <p className="text-[9px] text-[#445] px-2 py-1.5">
        Ctrl/Shift+click to multi-select · 🗑 to delete
      </p>

      {filtered.map((entry) => (
        <MemoMeshRow
          key={entry.uuid}
          entry={entry}
          isSelected={selectedUUIDs.has(entry.uuid)}
          isPrimary={selectedUUID === entry.uuid}
          isWire={isWireframe(entry.uuid)}
          onSelect={handleSelect}
          onToggleVis={toggleVis}
          onToggleWire={toggleWire}
          onDelete={confirmDelete}
        />
      ))}
    </div>
  );
}
