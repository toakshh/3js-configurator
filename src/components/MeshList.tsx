"use client";

import { useGLBStore } from "@/store/glbStore";
import { selectMeshByUUID } from "@/hooks/useViewport";
import { ViewportRefs } from "@/hooks/useViewport";

export default function MeshList({ vpRefs }: { vpRefs: React.MutableRefObject<ViewportRefs> }) {
  const store = useGLBStore();
  const q = store.searchQuery.toLowerCase();
  const filtered = store.meshEntries.filter(
    (e) => !q || e.name.toLowerCase().includes(q)
  );

  const handleSelect = (uuid: string) => {
    selectMeshByUUID(uuid, vpRefs.current);
    store.selectMesh(uuid);
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

  return (
    <div className="flex-1 overflow-y-auto px-2 pb-2 scrollbar-thin">
      <p className="text-[10px] text-[#556] uppercase tracking-widest px-2 py-2">
        Meshes ({filtered.length})
      </p>
      {filtered.map((entry) => {
        const isSelected = store.selectedUUID === entry.uuid;
        return (
          <div
            key={entry.uuid}
            onClick={() => handleSelect(entry.uuid)}
            className={`flex items-center gap-2 px-3 py-2 rounded-lg mb-1 cursor-pointer border transition-all group
              ${
                isSelected
                  ? "bg-[#5b6ef5]/15 border-[#5b6ef5]"
                  : "bg-transparent border-transparent hover:bg-[#1e2235]"
              }`}
          >
            <span className="text-[14px] flex-shrink-0 opacity-60">⬡</span>
            <span
              className={`flex-1 text-[12px] truncate ${
                isSelected ? "text-[#7c8bff]" : "text-[#ccd]"
              }`}
              title={entry.name}
            >
              {entry.name}
            </span>
            <span className="text-[9px] text-[#445] flex-shrink-0 bg-[#1e2235] px-1.5 py-0.5 rounded">
              {entry.vertexCount}v
            </span>
            <button
              onClick={(e) => toggleVis(entry.uuid, entry.visible, e)}
              className={`text-[12px] transition-opacity flex-shrink-0
                ${entry.visible ? "opacity-0 group-hover:opacity-100" : "opacity-100 text-[#f5a623]"}`}
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
