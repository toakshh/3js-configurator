"use client";

import * as THREE from "three";
import { useGLBStore } from "@/store/glbStore";
import { getMeshMat } from "@/lib/matUtils";
import { ViewportRefs, getMesh } from "@/hooks/useViewport";

function InfoCell({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="bg-[#1e2235] rounded-md p-2">
      <p className="text-[9px] text-[#445] mb-0.5 uppercase tracking-wider">{label}</p>
      <p className="text-[11px] text-[#7c8bff] truncate">{value}</p>
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 text-[10px] uppercase tracking-widest text-[#556] mt-4 mb-2 pb-1 border-b border-[#1e2235] first:mt-1">
      {children}
    </div>
  );
}

export default function InfoTab({ vpRefs }: { vpRefs: React.MutableRefObject<ViewportRefs> }) {
  const uuid = useGLBStore((s) => s.selectedUUID);
  const entry = useGLBStore((s) => s.meshEntries.find((e) => e.uuid === s.selectedUUID));
  // Everything below reads live Three.js state, so re-render on revision bumps.
  useGLBStore((s) => s.revision);
  const refresh = useGLBStore((s) => s.bumpRevision);
  const mesh = uuid ? getMesh(vpRefs.current, uuid) : null;

  if (!mesh || !entry) {
    return (
      <div className="flex items-center justify-center h-full text-[#445] text-xs p-6 text-center">
        Select a mesh to view its info
      </div>
    );
  }

  const mat = getMeshMat(mesh);
  const geo = mesh.geometry;
  const box = new THREE.Box3().setFromObject(mesh);
  const size = box.getSize(new THREE.Vector3());
  const wPos = mesh.getWorldPosition(new THREE.Vector3());
  const morphCount = geo?.morphAttributes?.position?.length ?? 0;
  const uvChannels = Object.keys(geo?.attributes ?? {}).filter((k) => k.startsWith("uv")).length;

  return (
    <div className="p-3">
      <SectionTitle>📋 Mesh Info</SectionTitle>
      <div className="grid grid-cols-2 gap-1.5 mb-1">
        <InfoCell label="Name" value={entry.name} />
        <InfoCell label="UUID" value={entry.uuid.slice(0, 12) + "…"} />
        <InfoCell label="Vertices" value={entry.vertexCount} />
        <InfoCell label="Triangles" value={entry.faceCount} />
        <InfoCell label="UV Channels" value={uvChannels} />
        <InfoCell label="Has Normals" value={entry.hasNormals ? "Yes" : "No"} />
        <InfoCell label="Vtx Colors" value={entry.hasVertexColor ? "Yes" : "No"} />
        <InfoCell label="Morph Targets" value={morphCount || "None"} />
        <InfoCell label="Material Type" value={mat?.type ?? "—"} />
        <InfoCell label="Frustum Cull" value={mesh.frustumCulled ? "Yes" : "No"} />
        <InfoCell label="Cast Shadow" value={mesh.castShadow ? "Yes" : "No"} />
        <InfoCell label="Receive Shadow" value={mesh.receiveShadow ? "Yes" : "No"} />
      </div>

      <SectionTitle>📐 Bounding Box (world)</SectionTitle>
      <div className="grid grid-cols-3 gap-1.5 mb-1">
        <InfoCell label="Width X" value={size.x.toFixed(4)} />
        <InfoCell label="Height Y" value={size.y.toFixed(4)} />
        <InfoCell label="Depth Z" value={size.z.toFixed(4)} />
      </div>

      <SectionTitle>🌐 World Position</SectionTitle>
      <div className="grid grid-cols-3 gap-1.5 mb-1">
        <InfoCell label="World X" value={wPos.x.toFixed(4)} />
        <InfoCell label="World Y" value={wPos.y.toFixed(4)} />
        <InfoCell label="World Z" value={wPos.z.toFixed(4)} />
      </div>

      {morphCount > 0 && (
        <>
          <SectionTitle>🎬 Morph Targets ({morphCount})</SectionTitle>
          <div className="space-y-1.5">
            {Array.from({ length: morphCount }).map((_, i) => (
              <div key={i} className="flex items-center gap-2">
                <span className="text-[11px] text-[#778] w-16 shrink-0">Target {i}</span>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.01}
                  value={mesh.morphTargetInfluences?.[i] ?? 0}
                  className="flex-1 accent-[#5b6ef5]"
                  onChange={(e) => {
                    if (mesh.morphTargetInfluences) {
                      mesh.morphTargetInfluences[i] = parseFloat(e.target.value);
                      refresh();
                    }
                  }}
                />
                <span className="text-[11px] text-[#7c8bff] w-8 text-right tabular-nums">
                  {(mesh.morphTargetInfluences?.[i] ?? 0).toFixed(2)}
                </span>
              </div>
            ))}
          </div>
        </>
      )}

      <SectionTitle>🔧 Flags</SectionTitle>
      {[
        {
          label: "Frustum Culled",
          value: mesh.frustumCulled,
          set: (v: boolean) => { mesh.frustumCulled = v; refresh(); },
        },
      ].map(({ label, value, set }) => (
        <div key={label} className="flex items-center justify-between mb-2">
          <span className="text-[11px] text-[#778]">{label}</span>
          <label className="relative w-8 h-4 cursor-pointer">
            <input
              type="checkbox"
              className="sr-only peer"
              checked={value}
              onChange={(e) => set(e.target.checked)}
            />
            <span className="absolute inset-0 bg-[#2e3250] rounded-full transition-colors peer-checked:bg-[#5b6ef5]" />
            <span className="absolute left-0.5 top-0.5 w-3 h-3 bg-white rounded-full transition-transform peer-checked:translate-x-4" />
          </label>
        </div>
      ))}
    </div>
  );
}
