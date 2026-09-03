"use client";

import { useGLBStore } from "@/store/glbStore";
import { syncHighlightsToSelection } from "@/hooks/useViewport";
import { ViewportRefs } from "@/hooks/useViewport";

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
    // sync three.js highlights after state updates (next tick)
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

  if (store.meshEntries.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-[#445] text-xs p-4 text-center">
        Load a .glb file to see its meshes
      </div>
    );
  }

  const selCount = store.selectedUUIDs.size;

  return (
    <div className="flex-1 overflow-y-auto px-2 pb-2 scrollbar-thin">
      <div className="flex items-center justify-between px-2 py-2">
        <p className="text-[10px] text-[#556] uppercase tracking-widest">
          Meshes ({filtered.length})
        </p>
        {selCount > 1 && (
          <span className="text-[9px] bg-[#5b6ef5]/20 text-[#7c8bff] border border-[#5b6ef5]/40 px-1.5 py-0.5 rounded-full">
            {selCount} selected
          </span>
        )}
      </div>
      <p className="text-[9px] text-[#445] px-2 pb-1.5">
        Ctrl+click or Shift+click to multi-select
      </p>
      {filtered.map((entry) => {
        const isSelected = store.selectedUUIDs.has(entry.uuid);
        const isPrimary = store.selectedUUID === entry.uuid;
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
            {/* selection indicator */}
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
            <span className="text-[9px] text-[#445] flex-shrink-0 bg-[#1a1d27] px-1.5 py-0.5 rounded">
              {entry.vertexCount}v
            </span>
            <button
              onClick={(e) => toggleVis(entry.uuid, entry.visible, e)}
              className={`text-[12px] transition-opacity flex-shrink-0
                ${entry.visible ? "opacity-0 group-hover:opacity-70 hover:!opacity-100" : "opacity-100 text-[#f5a623]"}`}
              title={entry.visible ? "Hide" : "Show"}
            >
              {entry.visible ? "👁" : "🚫"}
            </button>
          </div>
        );
      })}
    </div>
  );
}
