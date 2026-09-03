"use client";

import { useGLBStore, ActiveTab } from "@/store/glbStore";
import MaterialTab from "./MaterialTab";
import TransformTab from "./TransformTab";
import InfoTab from "./InfoTab";
import { ViewportRefs, applyHistoryStep } from "@/hooks/useViewport";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";
import { useEffect, useCallback } from "react";
import { toast } from "react-hot-toast";

const TABS: { id: ActiveTab; label: string; icon: string }[] = [
  { id: "material", label: "Material", icon: "🎨" },
  { id: "transform", label: "Transform", icon: "⇲" },
  { id: "info", label: "Info", icon: "ℹ" },
];

export default function RightPanel({
  vpRefs,
}: {
  vpRefs: React.MutableRefObject<ViewportRefs>;
}) {
  const store = useGLBStore();
  const selectedEntry = store.meshEntries.find((e) => e.uuid === store.selectedUUID);
  const multiCount = store.selectedUUIDs.size;

  const canUndo = store.historyIndex > 0;
  const canRedo = store.historyIndex < store.history.length - 1;

  const doUndo = useCallback(() => {
    const step = store.undo();
    if (!step) return;
    applyHistoryStep(step, vpRefs.current);
    store.setMeshEntries([...store.meshEntries]);
  }, [store, vpRefs]);

  const doRedo = useCallback(() => {
    const step = store.redo();
    if (!step) return;
    applyHistoryStep(step, vpRefs.current);
    store.setMeshEntries([...store.meshEntries]);
  }, [store, vpRefs]);

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const active = document.activeElement;
      // Don't fire inside inputs
      if (active && (active.tagName === "INPUT" || active.tagName === "TEXTAREA" || active.tagName === "SELECT")) return;
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === "z") {
        e.preventDefault();
        doUndo();
      }
      if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === "y" || (e.shiftKey && e.key.toLowerCase() === "z"))) {
        e.preventDefault();
        doRedo();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [doUndo, doRedo]);

  const exportGLB = () => {
    const root = vpRefs.current.gltfRoot;
    if (!root) { toast.error("Load a GLB first"); return; }

    const loadingToast = toast.loading("Exporting GLB...");

    // Temporarily restore emissive for selected meshes so highlight doesn't bake in
    const restoreList: { uuid: string; emissive: number; emissiveIntensity: number }[] = [];
    vpRefs.current.highlightMap.forEach((backup, uuid) => {
      const mesh = vpRefs.current.allMeshes.find((m) => m.uuid === uuid);
      if (!mesh) return;
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      mats.forEach((m: any) => {
        if (m.emissive) { m.emissive.set(backup.emissive); m.emissiveIntensity = backup.emissiveIntensity; }
      });
      restoreList.push({ uuid, ...backup });
    });

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

        // Re-apply highlights
        restoreList.forEach(({ uuid }) => {
          const mesh = vpRefs.current.allMeshes.find((m) => m.uuid === uuid);
          if (!mesh) return;
          const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
          mats.forEach((m: any) => { if (m.emissive) { m.emissive.set(0xff6b35); m.emissiveIntensity = 0.3; } });
        });

        toast.success("Exported as configured.glb", { id: loadingToast });
      },
      (err) => { 
        console.error(err); 
        toast.error("Export failed: " + err, { id: loadingToast });
      },
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
        m.depthWrite = snap.depthWrite;
        m.blending = snap.blending;
        if ("envMapIntensity" in m) m.envMapIntensity = snap.envMapIntensity;
        m.needsUpdate = true;
      });
    });
    toast("All materials reset to original", { icon: "↺" });
    store.setMeshEntries([...store.meshEntries]);
  };

  return (
    <div className="w-[400px] min-w-[320px] bg-[#0e1120] border-l border-[#1a1f38] flex flex-col shrink-0 overflow-hidden">

      {/* ── Header ─────────────────────────────────────── */}
      <div className="px-5 pt-4 pb-3 border-b border-[#1a1f38] bg-[#0c0f1e] shrink-0">
        {/* Mesh name */}
        <div className="flex items-start gap-3 mb-3">
          <div className="w-8 h-8 rounded-lg bg-[#5b6ef5]/15 border border-[#5b6ef5]/25 flex items-center justify-center shrink-0 mt-0.5">
            <span className="text-[14px]">⬡</span>
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-[13px] font-semibold text-[#c8cef0] truncate">
              {selectedEntry
                ? selectedEntry.name
                : multiCount > 1
                ? `${multiCount} meshes selected`
                : "No mesh selected"}
            </h2>
            <p className="text-[10px] text-[#3a4270] mt-0.5 mt-1">
              {selectedEntry
                ? `${selectedEntry.vertexCount.toLocaleString()} verts · ${selectedEntry.materialType}`
                : multiCount > 1
                ? "Changes apply to all selected"
                : "Select a mesh to begin editing"}
            </p>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 bg-[#080a18] rounded-xl p-1">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => store.setActiveTab(t.id)}
              className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-[11px] font-medium transition-all
                ${store.activeTab === t.id
                  ? "bg-[#5b6ef5] text-white shadow-lg shadow-[#5b6ef5]/25"
                  : "text-[#3a4270] hover:text-[#7880a8]"
                }`}
            >
              <span className="text-[12px]">{t.icon}</span>
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* ── Undo / Redo bar ────────────────────────────── */}
      <div className="flex items-center gap-2 px-5 py-2 border-b border-[#1a1f38] bg-[#0a0d1c] shrink-0">
        <button
          onClick={doUndo}
          disabled={!canUndo}
          title="Undo (Ctrl+Z)"
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-medium border transition-all
            ${canUndo
              ? "bg-[#12152a] border-[#1e2440] text-[#7880a8] hover:border-[#5b6ef5] hover:text-[#a0a8ff]"
              : "bg-[#0a0d1c] border-[#13162a] text-[#2a3050] cursor-not-allowed"
            }`}
        >
          <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
            <path d="M3 7v6h6M3 13C5 7.5 10 4 16 4a9 9 0 010 18c-4 0-7.5-1.5-9.5-4" />
          </svg>
          Undo
        </button>
        <button
          onClick={doRedo}
          disabled={!canRedo}
          title="Redo (Ctrl+Y)"
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-medium border transition-all
            ${canRedo
              ? "bg-[#12152a] border-[#1e2440] text-[#7880a8] hover:border-[#5b6ef5] hover:text-[#a0a8ff]"
              : "bg-[#0a0d1c] border-[#13162a] text-[#2a3050] cursor-not-allowed"
            }`}
        >
          <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
            <path d="M21 7v6h-6M21 13C19 7.5 14 4 8 4a9 9 0 000 18c4 0 7.5-1.5 9.5-4" />
          </svg>
          Redo
        </button>
        <div className="flex-1" />
        <span className="text-[9px] text-[#1e2440] font-mono">
          {store.history.length > 0 ? `${store.historyIndex + 1}/${store.history.length}` : "0/0"}
        </span>
      </div>

      {/* ── Tab content ────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto scrollbar-thin">
        <div className={store.activeTab === "material" ? "block" : "hidden"}>
          <MaterialTab vpRefs={vpRefs} />
        </div>
        <div className={store.activeTab === "transform" ? "block" : "hidden"}>
          <TransformTab vpRefs={vpRefs} />
        </div>
        <div className={store.activeTab === "info" ? "block" : "hidden"}>
          <InfoTab vpRefs={vpRefs} />
        </div>
      </div>

      {/* ── Export / Reset bar ─────────────────────────── */}
      <div className="px-5 py-4 border-t border-[#1a1f38] bg-[#0c0f1e] space-y-3 shrink-0">
        <button
          onClick={exportGLB}
          className="w-full bg-gradient-to-r from-[#5b6ef5] to-[#7c5bf5] hover:from-[#6b7eff] hover:to-[#8c6bff] text-white font-semibold py-3.5 rounded-xl text-[13px] transition-all shadow-lg shadow-[#5b6ef5]/20 flex items-center justify-center gap-2.5"
        >
          <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
            <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3" />
          </svg>
          Export Modified .glb
        </button>
        <button
          onClick={resetAll}
          className="w-full bg-[#12152a] border border-[#1e2440] hover:border-[#5b6ef5]/50 text-[#4a5280] hover:text-[#7880a8] py-2.5 rounded-xl text-[12px] font-medium transition-all"
        >
          ↺ Revert All to Original
        </button>
      </div>
    </div>
  );
}
