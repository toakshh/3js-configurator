"use client";

import { useGLBStore } from "@/store/glbStore";
import DropZone from "./DropZone";
import MeshList from "./MeshList";
import { ViewportRefs } from "@/hooks/useViewport";

export default function LeftPanel({
  loadGLB,
  vpRefs,
}: {
  loadGLB: (f: File) => void;
  vpRefs: React.MutableRefObject<ViewportRefs>;
}) {
  const store = useGLBStore();

  return (
    <div className="w-[280px] min-w-[200px] bg-[#1a1d27] border-r border-[#2e3250] flex flex-col shrink-0 overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 border-b border-[#2e3250] bg-[#22263a] shrink-0">
        <h1 className="text-[15px] font-bold text-[#7c8bff] tracking-wide">🎛 GLB Configurator</h1>
        <p className="text-[10px] text-[#556] mt-0.5">Three.js mesh inspector & editor</p>
      </div>

      {/* Drop zone */}
      <div className="py-3 shrink-0">
        <DropZone loadGLB={loadGLB} />
      </div>

      {/* Search */}
      <div className="px-3 pb-2 shrink-0">
        <input
          type="text"
          placeholder="🔍  Search meshes…"
          value={store.searchQuery}
          className="w-full bg-[#22263a] border border-[#2e3250] rounded-lg text-[12px] text-[#ccd] px-3 py-1.5 outline-none focus:border-[#5b6ef5] placeholder:text-[#445] transition-colors"
          onChange={(e) => store.setSearchQuery(e.target.value)}
        />
      </div>

      {/* Mesh list */}
      <MeshList vpRefs={vpRefs} />

      {/* Stats footer */}
      {store.meshEntries.length > 0 && (
        <div className="px-3 py-2 border-t border-[#2e3250] bg-[#22263a] shrink-0 flex justify-between text-[10px] text-[#445]">
          <span>{store.meshEntries.length} meshes</span>
          <span>
            {store.meshEntries.reduce((acc, e) => acc + e.vertexCount, 0).toLocaleString()} verts
          </span>
          <span>
            {store.meshEntries.reduce((acc, e) => acc + e.faceCount, 0).toLocaleString()} tris
          </span>
        </div>
      )}
    </div>
  );
}
