"use client";

import { useGLBStore, ActiveTab } from "@/store/glbStore";
import MaterialTab from "./MaterialTab";
import TransformTab from "./TransformTab";
import InfoTab from "./InfoTab";
import { ViewportRefs } from "@/hooks/useViewport";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";
import { useState } from "react";

const TABS: { id: ActiveTab; label: string }[] = [
  { id: "material", label: "Material" },
  { id: "transform", label: "Transform" },
  { id: "info", label: "Info" },
];

export default function RightPanel({
  vpRefs,
}: {
  vpRefs: React.MutableRefObject<ViewportRefs>;
}) {
  const store = useGLBStore();
  const selectedEntry = store.meshEntries.find((e) => e.uuid === store.selectedUUID);
  const [toast, setToast] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  };

  const exportGLB = () => {
    const root = vpRefs.current.gltfRoot;
    if (!root) { alert("Load a GLB first"); return; }

    // temporarily clear highlight emissive so highlight orange doesn't bake into export
    const uuid = store.selectedUUID;
    if (uuid) {
      const mesh = vpRefs.current.allMeshes.find((m) => m.uuid === uuid);
      const backup = vpRefs.current.highlightMap.get(uuid);
      if (mesh && backup) {
        const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        mats.forEach((m: any) => { if (m.emissive) { m.emissive.set(backup.emissive); m.emissiveIntensity = backup.emissiveIntensity; } });
      }
    }

    const exporter = new GLTFExporter();
    exporter.parse(
      root,
      (result) => {
        const blob = new Blob([result as ArrayBuffer], { type: "model/gltf-binary" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = "configured.glb";
        a.click();
        URL.revokeObjectURL(url);

        // re-apply highlight
        if (uuid) {
          const mesh = vpRefs.current.allMeshes.find((m) => m.uuid === uuid);
          if (mesh) {
            const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
            mats.forEach((m: any) => { if (m.emissive) { m.emissive.set(0xff6b35); m.emissiveIntensity = 0.25; } });
          }
        }
        showToast("✓ Exported as configured.glb");
      },
      (err) => { console.error(err); alert("Export failed: " + err); },
      { binary: true }
    );
  };

  const resetAll = () => {
    if (!confirm("Reset ALL meshes to their original loaded material state?")) return;
    store.meshEntries.forEach((entry) => {
      const mesh = vpRefs.current.allMeshes.find((m) => m.uuid === entry.uuid);
      const snap = store.snapshots.get(entry.uuid);
      if (!mesh || !snap) return;
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      mats.forEach((m: any) => {
        if (m.color) m.color.set(snap.color);
        m.roughness = snap.roughness;
        m.metalness = snap.metalness;
        if (m.emissive) m.emissive.set(snap.emissive);
        m.emissiveIntensity = snap.emissiveIntensity;
        m.opacity = snap.opacity;
        m.transparent = snap.transparent;
        m.wireframe = snap.wireframe;
        m.flatShading = snap.flatShading;
        m.side = snap.side;
        m.needsUpdate = true;
      });
    });
    showToast("↺ All materials reset");
    store.setMeshEntries([...store.meshEntries]);
  };

  return (
    <div className="w-[340px] min-w-[240px] bg-[#1a1d27] border-l border-[#2e3250] flex flex-col shrink-0 overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 border-b border-[#2e3250] bg-[#22263a] flex items-center gap-3 shrink-0">
        <h2 className="text-[13px] font-semibold text-[#e8eaf6] flex-1 truncate">
          {selectedEntry ? selectedEntry.name : "No mesh selected"}
        </h2>
        {/* Tabs */}
        <div className="flex gap-0.5 bg-[#141620] rounded-md p-0.5 shrink-0">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => store.setActiveTab(t.id)}
              className={`px-2.5 py-1 rounded text-[11px] transition-colors whitespace-nowrap
                ${store.activeTab === t.id
                  ? "bg-[#5b6ef5] text-white"
                  : "text-[#778] hover:text-[#ccd]"
                }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Tab body */}
      <div className="flex-1 overflow-y-auto scrollbar-thin">
        {store.activeTab === "material" && <MaterialTab vpRefs={vpRefs} />}
        {store.activeTab === "transform" && <TransformTab vpRefs={vpRefs} />}
        {store.activeTab === "info" && <InfoTab vpRefs={vpRefs} />}
      </div>

      {/* Export bar */}
      <div className="px-3 py-3 border-t border-[#2e3250] space-y-2 shrink-0">
        <button
          onClick={exportGLB}
          className="w-full bg-[#5b6ef5] hover:bg-[#7c8bff] text-white font-semibold py-2.5 rounded-lg text-[13px] transition-colors flex items-center justify-center gap-2"
        >
          <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
            <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3" />
          </svg>
          Export Modified .glb
        </button>
        <button
          onClick={resetAll}
          className="w-full bg-[#1e2235] border border-[#2e3250] hover:border-[#5b6ef5] text-[#ccd] py-2 rounded-lg text-[12px] transition-colors"
        >
          ↺ Reset All Materials
        </button>
      </div>

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-5 left-1/2 -translate-x-1/2 bg-[#4caf90] text-white text-[12px] font-semibold px-5 py-2 rounded-full shadow-lg z-50 animate-bounce">
          {toast}
        </div>
      )}
    </div>
  );
}
