"use client";

import { useRef, useEffect } from "react";
import { useGLBStore } from "@/store/glbStore";
import {
  useViewport,
  frameAll,
  frameSelected,
  selectMeshByUUID,
} from "@/hooks/useViewport";
import * as THREE from "three";

export default function Viewport() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { refs, loadGLB, handleCanvasClick } = useViewport(canvasRef);
  const store = useGLBStore();

  // Sync grid visibility
  useEffect(() => {
    if (refs.current.grid) refs.current.grid.visible = store.showGrid;
  }, [store.showGrid, refs]);

  // Sync global wireframe
  useEffect(() => {
    refs.current.allMeshes.forEach((mesh) => {
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      mats.forEach((m) => {
        (m as THREE.MeshStandardMaterial).wireframe = store.globalWireframe;
      });
    });
  }, [store.globalWireframe, refs]);

  // Sync env mode
  useEffect(() => {
    const r = refs.current;
    if (!r.scene) return;
    const scene = r.scene;
    const renderer = r.renderer;
    if (!renderer) return;
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
  }, [store.envMode, refs]);

  // Sync skybox
  useEffect(() => {
    const r = refs.current;
    if (!r.scene) return;
    if (store.skybox) {
      r.scene.background = new THREE.Color(0x1a2a4a);
    } else if (store.envMode === "studio") {
      r.scene.background = new THREE.Color(0x141620);
    }
  }, [store.skybox, store.envMode, refs]);

  // Sync camera mode
  useEffect(() => {
    const r = refs.current;
    if (!r.perspCamera || !r.orthoCamera || !r.controls) return;
    if (store.cameraMode === "ortho") {
      r.orthoCamera.position.copy(r.perspCamera.position);
      r.orthoCamera.quaternion.copy(r.perspCamera.quaternion);
    }
  }, [store.cameraMode, refs]);

  // Sync selectedUUID in refs (highlights are handled via line outlines)
  useEffect(() => {
    refs.current.selectedUUID = store.selectedUUID;
  }, [store.selectedUUID, refs]);

  // Drag-drop on canvas
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) loadGLB(file);
  };

  const envLabels: Record<string, string> = {
    studio: "Studio",
    outdoor: "Outdoor",
    dark: "Dark",
    none: "None",
  };
  const envCycle: Record<string, string> = {
    studio: "outdoor",
    outdoor: "dark",
    dark: "none",
    none: "studio",
  };

  return (
    <div className="relative flex-1 overflow-hidden bg-[#141620]">
      <canvas
        ref={canvasRef}
        className="block w-full h-full"
        onClick={handleCanvasClick}
        onDragOver={(e) => e.preventDefault()}
        onDrop={handleDrop}
      />

      {/* No-file overlay */}
      {store.meshEntries.length === 0 && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 pointer-events-none text-[#556]">
          <svg
            width={72}
            height={72}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={1}
            className="opacity-20"
          >
            <path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z" />
            <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
            <line x1="12" y1="22.08" x2="12" y2="12" />
          </svg>
          <span className="text-sm">Drop a .glb file anywhere or use the panel</span>
        </div>
      )}

      {/* Top toolbar */}
      <div className="absolute top-3 left-3 flex gap-2 flex-wrap">
        {(["perspective", "ortho"] as const).map((m) => (
          <VpBtn
            key={m}
            active={store.cameraMode === m}
            onClick={() => store.setCameraMode(m)}
          >
            {m === "perspective" ? "Perspective" : "Orthographic"}
          </VpBtn>
        ))}
        <VpBtn
          onClick={() => {
            refs.current.perspCamera!.position.set(3, 2, 5);
            refs.current.controls!.target.set(0, 0, 0);
            refs.current.controls!.update();
          }}
        >
          Reset View
        </VpBtn>
        <VpBtn
          active={store.globalWireframe}
          onClick={() => store.setGlobalWireframe(!store.globalWireframe)}
        >
          Wireframe
        </VpBtn>
        <VpBtn
          active={!store.showGrid}
          onClick={() => store.setShowGrid(!store.showGrid)}
        >
          Grid
        </VpBtn>
        <VpBtn
          onClick={() => store.setEnvMode(envCycle[store.envMode] as "studio")}
        >
          Env: {envLabels[store.envMode]}
        </VpBtn>
        <VpBtn
          active={store.skybox}
          onClick={() => store.setSkybox(!store.skybox)}
        >
          Skybox
        </VpBtn>
      </div>

      {/* Selected label */}
      {store.selectedUUID && (
        <div className="absolute top-3 right-3 bg-black/60 border border-[#2e3250] rounded-md px-3 py-1.5 text-xs text-[#7c8bff] backdrop-blur pointer-events-none">
          ●{" "}
          {store.meshEntries.find((e) => e.uuid === store.selectedUUID)?.name ??
            "—"}
        </div>
      )}

      {/* Bottom toolbar */}
      <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex gap-2">
        <VpBtn onClick={() => frameAll(refs.current)}>Frame All</VpBtn>
        <VpBtn
          onClick={() => {
            if (store.selectedUUID) frameSelected(store.selectedUUID, refs.current);
          }}
        >
          Frame Selected
        </VpBtn>
        <VpBtn
          onClick={() => {
            store.selectMesh(null);
          }}
        >
          Deselect
        </VpBtn>
      </div>
    </div>
  );
}

function VpBtn({
  children,
  onClick,
  active,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  active?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={`px-2.5 py-1 rounded-md text-[11px] border backdrop-blur transition-colors
        ${
          active
            ? "border-[#5b6ef5] bg-[#5b6ef5]/20 text-[#7c8bff]"
            : "border-[#2e3250] bg-black/60 text-[#ccd] hover:border-[#5b6ef5] hover:text-[#7c8bff]"
        }`}
    >
      {children}
    </button>
  );
}
