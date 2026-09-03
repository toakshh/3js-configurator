"use client";

import { useEffect } from "react";
import * as THREE from "three";
import { useGLBStore, EnvMode } from "@/store/glbStore";
import { ViewportRefs, frameAll, frameSelected } from "@/hooks/useViewport";

const ENV_LABELS: Record<EnvMode, string> = {
  studio: "Studio",
  outdoor: "Outdoor",
  dark: "Dark",
  none: "None",
};

const ENV_CYCLE: Record<EnvMode, EnvMode> = {
  studio: "outdoor",
  outdoor: "dark",
  dark: "none",
  none: "studio",
};

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
  // Field-level selectors: toggling the grid no longer re-renders the panels,
  // and a search keystroke no longer re-renders the viewport chrome.
  const cameraMode = useGLBStore((s) => s.cameraMode);
  const showGrid = useGLBStore((s) => s.showGrid);
  const globalWireframe = useGLBStore((s) => s.globalWireframe);
  const envMode = useGLBStore((s) => s.envMode);
  const skybox = useGLBStore((s) => s.skybox);
  const selectedUUID = useGLBStore((s) => s.selectedUUID);
  const selCount = useGLBStore((s) => s.selectedUUIDs.size);
  const meshCount = useGLBStore((s) => s.meshEntries.length);
  const selectedName = useGLBStore(
    (s) => s.meshEntries.find((e) => e.uuid === s.selectedUUID)?.name ?? null
  );

  const setCameraMode = useGLBStore((s) => s.setCameraMode);
  const setGlobalWireframe = useGLBStore((s) => s.setGlobalWireframe);
  const setShowGrid = useGLBStore((s) => s.setShowGrid);
  const setEnvMode = useGLBStore((s) => s.setEnvMode);
  const setSkybox = useGLBStore((s) => s.setSkybox);
  const clearSelection = useGLBStore((s) => s.clearSelection);

  // Camera mode switch handler (perspective <-> ortho)
  useEffect(() => {
    const r = vpRefs.current;
    if (!r.controls || !r.perspCamera || !r.orthoCamera) return;
    if (cameraMode === "ortho") {
      r.orthoCamera.position.copy(r.perspCamera.position);
      r.orthoCamera.quaternion.copy(r.perspCamera.quaternion);
      const d = r.perspCamera.position.distanceTo(r.controls.target);
      const height = 2 * d * Math.tan(THREE.MathUtils.degToRad(r.perspCamera.fov / 2));
      const aspect = r.perspCamera.aspect;
      r.orthoCamera.left = (-height * aspect) / 2;
      r.orthoCamera.right = (height * aspect) / 2;
      r.orthoCamera.top = height / 2;
      r.orthoCamera.bottom = -height / 2;
      r.orthoCamera.updateProjectionMatrix();
      r.controls.object = r.orthoCamera;
    } else {
      r.perspCamera.position.copy(r.orthoCamera.position);
      r.perspCamera.quaternion.copy(r.orthoCamera.quaternion);
      r.perspCamera.updateProjectionMatrix();
      r.controls.object = r.perspCamera;
    }
    r.controls.update();
  }, [cameraMode, vpRefs]);

  // Grid
  useEffect(() => {
    if (vpRefs.current.grid) vpRefs.current.grid.visible = showGrid;
  }, [showGrid, vpRefs]);

  // Global wireframe
  useEffect(() => {
    vpRefs.current.allMeshes.forEach((mesh) => {
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      mats.forEach((m) => {
        (m as THREE.MeshStandardMaterial).wireframe = globalWireframe;
      });
    });
  }, [globalWireframe, vpRefs]);

  // Environment + background. Skybox is folded in here so the two settings
  // can't fight over scene.background across separate effects.
  useEffect(() => {
    const r = vpRefs.current;
    if (!r.scene || !r.renderer) return;
    const { scene, renderer } = r;

    let background = 0x141620;
    let exposure = 1.0;
    if (envMode === "outdoor") {
      background = 0x87ceeb;
      exposure = 1.5;
    } else if (envMode === "dark") {
      background = 0x050810;
      exposure = 0.3;
    }
    if (skybox) background = 0x1a2a4a;

    scene.environment = envMode === "none" ? null : r.roomEnvTex;
    scene.background = new THREE.Color(background);
    renderer.toneMappingExposure = exposure;
  }, [envMode, skybox, vpRefs]);

  // Mirror the primary selection into the viewport refs
  useEffect(() => {
    vpRefs.current.selectedUUID = selectedUUID;
  }, [selectedUUID, vpRefs]);

  return (
    <div className="relative w-full h-full overflow-hidden bg-[#141620]">
      <canvas
        ref={canvasRef}
        className="block w-full h-full cursor-crosshair"
        onClick={handleCanvasClick}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          const f = e.dataTransfer.files[0];
          if (f) loadGLB(f);
        }}
      />

      {/* No-file overlay */}
      {meshCount === 0 && (
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
          <VpBtn key={m} active={cameraMode === m} onClick={() => setCameraMode(m)}>
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
        <VpBtn active={globalWireframe} onClick={() => setGlobalWireframe(!globalWireframe)}>
          Wireframe
        </VpBtn>
        <VpBtn onClick={() => setShowGrid(!showGrid)}>
          {showGrid ? "Hide Grid" : "Show Grid"}
        </VpBtn>
        <VpBtn onClick={() => setEnvMode(ENV_CYCLE[envMode])}>
          Env: {ENV_LABELS[envMode]}
        </VpBtn>
        <VpBtn active={skybox} onClick={() => setSkybox(!skybox)}>
          Skybox
        </VpBtn>
      </div>

      {/* Selection label */}
      {selectedUUID && (
        <div className="absolute top-3 right-3 bg-black/60 border border-[#2e3250] rounded-md px-3 py-1.5 text-xs text-[#7c8bff] backdrop-blur pointer-events-none flex items-center gap-2">
          {selCount > 1 ? (
            <span>{selCount} meshes selected</span>
          ) : (
            <span>● {selectedName ?? "—"}</span>
          )}
        </div>
      )}

      {/* Bottom toolbar */}
      <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex gap-1.5 pointer-events-auto">
        <VpBtn onClick={() => frameAll(vpRefs.current)}>Frame All</VpBtn>
        <VpBtn onClick={() => { if (selectedUUID) frameSelected(selectedUUID, vpRefs.current); }}>
          Frame Selected
        </VpBtn>
        <VpBtn onClick={clearSelection}>Deselect</VpBtn>
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
