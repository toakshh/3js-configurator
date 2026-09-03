"use client";

import * as THREE from "three";
import { useGLBStore } from "@/store/glbStore";
import { syncHighlightsToSelection } from "@/hooks/useViewport";
import { ViewportRefs } from "@/hooks/useViewport";
import { toast } from "react-hot-toast";
import { Trash2, Eye, EyeOff, Box } from "lucide-react";

export default function MeshList({ vpRefs }: { vpRefs: React.MutableRefObject<ViewportRefs> }) {
  const store = useGLBStore();
  const q = store.searchQuery.toLowerCase();
  const filtered = store.meshEntries.filter(
    (e) => !q || e.name.toLowerCase().includes(q)
  );

  const handleSelect = (uuid: string, e: React.MouseEvent) => {
    if (e.ctrlKey || e.metaKey) {
      store.toggleMeshSelection(uuid);
    } else if (e.shiftKey) {
      store.rangeSelectMesh(uuid);
    } else {
      store.selectMesh(uuid);
    }
    setTimeout(() => {
      syncHighlightsToSelection(useGLBStore.getState().selectedUUIDs, vpRefs.current);
    }, 0);
  };

  const toggleVis = (uuid: string, current: boolean, e: React.MouseEvent) => {
    e.stopPropagation();
    const mesh = vpRefs.current.allMeshes.find((m) => m.uuid === uuid);
    if (mesh) mesh.visible = !current;
    store.updateMeshVisibility(uuid, !current);
  };

  const confirmDelete = (uuid: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const entry = store.meshEntries.find((m) => m.uuid === uuid);
    if (!entry) return;

    // Use toast with promise for confirmation
    toast.dismiss();
    const confirmed = window.confirm(
      `Delete "${entry.name}" (${entry.vertexCount.toLocaleString()} verts, ${entry.faceCount.toLocaleString()} tris)?\n\nThis action cannot be undone.`
    );
    if (confirmed) {
      const mesh = vpRefs.current.allMeshes.find((m) => m.uuid === uuid);
      if (mesh) {
        // Remove from scene
        if (mesh.parent) mesh.parent.remove(mesh);
        mesh.geometry.dispose();
        if (Array.isArray(mesh.material)) {
          mesh.material.forEach((m) => m.dispose());
        } else if (mesh.material) {
          mesh.material.dispose();
        }
      }
      store.removeMesh(uuid);
      toast.success(`Deleted "${entry.name}"`);
    }
  };

  if (store.meshEntries.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-[#445] text-xs p-4 text-center">
        Load a .glb file to see its meshes
      </div>
    );
  }

  const selCount = store.selectedUUIDs.size;
  const globalWire = store.globalWireframe;

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
            checked={globalWire}
            onChange={() => store.setGlobalWireframe(!globalWire)}
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

      {filtered.map((entry) => {
        const isSelected = store.selectedUUIDs.has(entry.uuid);
        const isPrimary = store.selectedUUID === entry.uuid;
        const mesh = vpRefs.current.allMeshes.find((m) => m.uuid === entry.uuid);
        const isWire = mesh && Array.isArray(mesh.material)
          ? mesh.material.some((mat) => (mat as THREE.MeshStandardMaterial).wireframe)
          : mesh && (mesh.material as THREE.MeshStandardMaterial).wireframe;

        return (
          <div
            key={entry.uuid}
            onClick={(e) => handleSelect(entry.uuid, e)}
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
              onClick={(e) => toggleVis(entry.uuid, entry.visible, e)}
              className={`p-1 rounded transition-opacity flex-shrink-0
                ${entry.visible ? "opacity-0 group-hover:opacity-70 hover:!opacity-100 text-[#7c8bff]" : "opacity-100 text-[#f5a623]"}
                hover:bg-[#5b6ef5]/10`}
              title={entry.visible ? "Hide mesh" : "Show mesh"}
            >
              {entry.visible ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
            </button>

            {/* Per-mesh wireframe toggle */}
            {mesh && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
                  mats.forEach((m) => {
                    (m as THREE.MeshStandardMaterial).wireframe = !isWire;
                  });
                  store.setMeshEntries([...store.meshEntries]);
                }}
                className={`p-1 rounded transition-opacity flex-shrink-0
                  ${isWire ? "text-[#7c8bff] opacity-100" : "text-[#3a4270] opacity-100"}
                  hover:bg-[#5b6ef5]/10`}
                title={isWire ? "Disable wireframe" : "Enable wireframe"}
              >
                <Box className="w-4 h-4" />
              </button>
            )}

            {/* Vertex count */}
            <span className="text-[9px] text-[#445] flex-shrink-0 bg-[#1a1d27] px-1.5 py-0.5 rounded">
              {entry.vertexCount}v
            </span>

            {/* Delete button */}
            <button
              onClick={(e) => confirmDelete(entry.uuid, e)}
              className={`p-1 rounded transition-opacity flex-shrink-0 opacity-0 group-hover:opacity-100
                text-[#ff6b6b] hover:bg-[#ff6b6b]/10 hover:text-white`}
              title="Delete mesh"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        );
      })}
    </div>
  );
}