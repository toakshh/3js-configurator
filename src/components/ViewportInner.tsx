"use client";

import { useEffect } from "react";
import * as THREE from "three";
import { useGLBStore } from "@/store/glbStore";
import {
  ViewportRefs,
  frameAll,
  frameSelected,
  clearHighlight,
  syncHighlightsToSelection,
} from "@/hooks/useViewport";

export default function ViewportInner({
  canvasRef,
  handleCanvasClick,
  loadGLB,
  vpRefs,
}: {
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  handleCanvasClick: (e: React.MouseEvent<HTMLCanvasElement>) => void;
  loadGLB: (f: File) => void;
  vpRefs: React.MutableRefObject<ViewportRefs>;
}) {
  const store = useGLBStore();

  // Grid
  useEffect(() => {
    if (vpRefs.current.grid) vpRefs.current.grid.visible = store.showGrid;
  }, [store.showGrid]);

  // Global wireframe
  useEffect(() => {
    vpRefs.current.allMeshes.forEach((mesh) => {
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      mats.forEach((m) => { (m as THREE.MeshStandardMaterial).wireframe = store.globalWireframe; });
    });
  }, [store.globalWireframe]);

  // Environment
  useEffect(() => {
    const r = vpRefs.current;
    if (!r.scene || !r.renderer) return;
    const { scene, renderer } = r;
    if (store.envMode === "studio") {
      scene.environment = r.roomEnvTex;
      scene.background = new THREE.Color(0x141620);
      renderer.toneMappingExposure = 1.0;
    } else if (store.envMode === "outdoor") {
      scene.environment = r.roomEnvTex;
      scene.background = new THREE.Color(0x87ceeb);
      renderer.toneMappingExposure = 1.5;
    } else if (store.envMode === "dark") {
      scene.environment = r.roomEnvTex;
      scene.background = new THREE.Color(0x050810);
      renderer.toneMappingExposure = 0.3;
    } else {
      scene.environment = null;
      scene.background = new THREE.Color(0x141620);
      renderer.toneMappingExposure = 1.0;
    }
  }, [store.envMode]);

  // Skybox
  useEffect(() => {
    const r = vpRefs.current;
    if (!r.scene) return;
    r.scene.background = store.skybox ? new THREE.Color(0x1a2a4a) : new THREE.Color(0x141620);
  }, [store.skybox]);

  // Sync highlights whenever selectedUUIDs changes
  useEffect(() => {
    syncHighlightsToSelection(store.selectedUUIDs, vpRefs.current);
    vpRefs.current.selectedUUID = store.selectedUUID;
  }, [store.selectedUUIDs, store.selectedUUID]);

  const envLabels: Record<string, string> = {
    studio: "Studio", outdoor: "Outdoor", dark: "Dark", none: "None",
  };
  const envCycle: Record<string, string> = {
    studio: "outdoor", outdoor: "dark", dark: "none", none: "studio",
  };

  const selCount = store.selectedUUIDs.size;

  return (
    <div className="relative flex-1 overflow-hidden bg-[#141620]">
      <canvas
        ref={canvasRef}
        className="block w-full h-full cursor-crosshair"
        onClick={(e) => {
          handleCanvasClick(e);
          // After state update, sync highlights
          setTimeout(() => {
            syncHighlightsToSelection(useGLBStore.getState().selectedUUIDs, vpRefs.current);
          }, 0);
        }}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          const f = e.dataTransfer.files[0];
          if (f) loadGLB(f);
        }}
      />

      {/* No-file overlay */}
      {store.meshEntries.length === 0 && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 pointer-events-none text-[#334]">
          <svg width={80} height={80} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={0.8} className="opacity-15">
            <path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z" />
            <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
            <line x1="12" y1="22.08" x2="12" y2="12" />
          </svg>
          <p className="text-sm opacity-40">Drop a .glb here or use the left panel to load</p>
        </div>
      )}

      {/* Top toolbar */}
      <div className="absolute top-3 left-3 flex gap-1.5 flex-wrap pointer-events-auto">
        {(["perspective", "ortho"] as const).map((m) => (
          <VpBtn key={m} active={store.cameraMode === m} onClick={() => store.setCameraMode(m)}>
            {m === "perspective" ? "Perspective" : "Ortho"}
          </VpBtn>
        ))}
        <VpBtn onClick={() => {
          const r = vpRefs.current;
          if (r.perspCamera && r.controls) {
            r.perspCamera.position.set(3, 2, 5);
            r.controls.target.set(0, 0, 0);
            r.controls.update();
          }
        }}>Reset View</VpBtn>
        <VpBtn active={store.globalWireframe} onClick={() => store.setGlobalWireframe(!store.globalWireframe)}>
          Wireframe
        </VpBtn>
        <VpBtn onClick={() => store.setShowGrid(!store.showGrid)}>
          {store.showGrid ? "Hide Grid" : "Show Grid"}
        </VpBtn>
        <VpBtn onClick={() => store.setEnvMode(envCycle[store.envMode] as "studio")}>
          Env: {envLabels[store.envMode]}
        </VpBtn>
        <VpBtn active={store.skybox} onClick={() => store.setSkybox(!store.skybox)}>
          Skybox
        </VpBtn>
      </div>

      {/* Selection label */}
      {store.selectedUUID && (
        <div className="absolute top-3 right-3 bg-black/60 border border-[#2e3250] rounded-md px-3 py-1.5 text-xs text-[#7c8bff] backdrop-blur pointer-events-none flex items-center gap-2">
          {selCount > 1 ? (
            <span>{selCount} meshes selected</span>
          ) : (
            <span>● {store.meshEntries.find((e) => e.uuid === store.selectedUUID)?.name ?? "—"}</span>
          )}
        </div>
      )}

      {/* Bottom toolbar */}
      <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex gap-1.5 pointer-events-auto">
        <VpBtn onClick={() => frameAll(vpRefs.current)}>Frame All</VpBtn>
        <VpBtn onClick={() => { if (store.selectedUUID) frameSelected(store.selectedUUID, vpRefs.current); }}>
          Frame Selected
        </VpBtn>
        <VpBtn onClick={() => {
          store.clearSelection();
        }}>Deselect</VpBtn>
      </div>
    </div>
  );
}

function VpBtn({ children, onClick, active }: { children: React.ReactNode; onClick?: () => void; active?: boolean }) {
  return (
    <button
      onClick={onClick}
      className={`px-2.5 py-1 rounded-md text-[11px] border backdrop-blur transition-colors
        ${active
          ? "border-[#5b6ef5] bg-[#5b6ef5]/20 text-[#7c8bff]"
          : "border-[#2e3250] bg-black/60 text-[#aab] hover:border-[#5b6ef5] hover:text-[#7c8bff]"
        }`}
    >
      {children}
    </button>
  );
}
