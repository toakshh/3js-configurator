"use client";

import * as THREE from "three";
import { useGLBStore } from "@/store/glbStore";
import { getMeshMat, setAllMats, colorToHex, hexToColor, snapshotMaterial } from "@/lib/matUtils";
import { ViewportRefs, applyHighlight } from "@/hooks/useViewport";
import { useRef } from "react";

// ── Shared UI primitives ──────────────────────────────────────────────────

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 text-[10px] uppercase tracking-widest text-[#556] mt-4 mb-2 pb-1 border-b border-[#1e2235] first:mt-1">
      {children}
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2 mb-2">
      <label className="text-[11px] text-[#778] shrink-0 w-28">{label}</label>
      <div className="flex-1">{children}</div>
    </div>
  );
}

function RangeRow({
  label,
  min = 0,
  max = 1,
  step = 0.01,
  value,
  onChange,
  accent = "#5b6ef5",
}: {
  label: string;
  min?: number;
  max?: number;
  step?: number;
  value: number;
  onChange: (v: number) => void;
  accent?: string;
}) {
  return (
    <div className="flex items-center gap-2 mb-2">
      <span className="text-[11px] text-[#778] w-28 shrink-0">{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        className="flex-1 accent-[#5b6ef5] cursor-pointer h-1"
        onChange={(e) => onChange(parseFloat(e.target.value))}
      />
      <span className="text-[11px] text-[#7c8bff] w-9 text-right tabular-nums">
        {value.toFixed(2)}
      </span>
    </div>
  );
}

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between mb-2">
      <span className="text-[11px] text-[#778]">{label}</span>
      <label className="relative w-8 h-4 cursor-pointer">
        <input
          type="checkbox"
          className="sr-only peer"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
        />
        <span className="absolute inset-0 bg-[#2e3250] rounded-full transition-colors peer-checked:bg-[#5b6ef5]" />
        <span className="absolute left-0.5 top-0.5 w-3 h-3 bg-white rounded-full transition-transform peer-checked:translate-x-4" />
      </label>
    </div>
  );
}

function ColorPicker({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (hex: string) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-2 mb-2">
      <span className="text-[11px] text-[#778] w-28 shrink-0">{label}</span>
      <input
        type="color"
        value={value}
        className="flex-1 h-7 rounded border border-[#2e3250] bg-[#1e2235] cursor-pointer"
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}

function SelectRow({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string | number;
  options: { label: string; value: string | number }[];
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex items-center gap-2 mb-2">
      <span className="text-[11px] text-[#778] w-28 shrink-0">{label}</span>
      <select
        value={value}
        className="flex-1 bg-[#1e2235] border border-[#2e3250] rounded-md text-[11px] text-[#ccd] px-2 py-1 outline-none cursor-pointer"
        onChange={(e) => onChange(e.target.value)}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}

// ── Texture slot ───────────────────────────────────────────────────────────

function TexSlot({
  label,
  slot,
  mat,
  onUpdate,
}: {
  label: string;
  slot: string;
  mat: THREE.MeshStandardMaterial;
  onUpdate: () => void;
}) {
  const hasTex = !!(mat as unknown as Record<string, unknown>)[slot];

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const url = URL.createObjectURL(file);
    new THREE.TextureLoader().load(url, (tex) => {
      tex.colorSpace =
        slot === "map" || slot === "emissiveMap"
          ? THREE.SRGBColorSpace
          : THREE.LinearSRGBColorSpace;
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
      (mat as unknown as Record<string, unknown>)[slot] = tex;
      mat.needsUpdate = true;
      URL.revokeObjectURL(url);
      onUpdate();
    });
  };

  const clearTex = () => {
    (mat as unknown as Record<string, unknown>)[slot] = null;
    mat.needsUpdate = true;
    onUpdate();
  };

  return (
    <div className="flex items-center gap-2 mb-2">
      <span className="text-[11px] text-[#778] w-28 shrink-0">{label}</span>
      <label
        className="flex-1 flex items-center gap-1.5 border border-dashed border-[#2e3250] rounded-md px-2 py-1 cursor-pointer
          hover:border-[#5b6ef5] transition-colors text-[10px] text-[#556] hover:text-[#ccd]"
      >
        <input type="file" accept="image/*" className="hidden" onChange={handleFile} />
        📁 {hasTex ? "Replace" : "Upload"}
      </label>
      {hasTex && (
        <button
          onClick={clearTex}
          className="text-[#f5a623] text-[12px] hover:text-red-400 transition-colors"
          title="Remove texture"
        >
          ✕
        </button>
      )}
      {hasTex && (
        <span className="text-[9px] text-[#4caf90] bg-[#1e2235] px-1.5 py-0.5 rounded">✓</span>
      )}
    </div>
  );
}

// ── Main Material Tab ──────────────────────────────────────────────────────

export default function MaterialTab({
  vpRefs,
}: {
  vpRefs: React.MutableRefObject<ViewportRefs>;
}) {
  const store = useGLBStore();
  const uuid = store.selectedUUID;
  const entry = store.meshEntries.find((e) => e.uuid === uuid);
  const mesh = entry
    ? vpRefs.current.allMeshes.find((m) => m.uuid === uuid)
    : null;

  const forceUpdate = useGLBStore((s) => s.setMeshEntries);

  if (!mesh) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3 text-[#445] text-xs p-6 text-center">
        <svg width={36} height={36} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1} className="opacity-30">
          <circle cx={12} cy={12} r={10} />
          <line x1={12} y1={8} x2={12} y2={12} />
          <line x1={12} y1={16} x2="12.01" y2={16} />
        </svg>
        Select a mesh to edit its material
      </div>
    );
  }

  const mat = getMeshMat(mesh);
  if (!mat) return <div className="text-xs text-[#556] p-4">No material on this mesh.</div>;

  const isPhysical = mat.type === "MeshPhysicalMaterial";
  const isStandard = isPhysical || mat.type === "MeshStandardMaterial";
  const phys = mat as THREE.MeshPhysicalMaterial;

  // trigger re-render after mutation
  const refresh = () => forceUpdate([...store.meshEntries]);

  const set = <K extends keyof THREE.MeshStandardMaterial>(key: K, val: THREE.MeshStandardMaterial[K]) => {
    setAllMats(mesh, (m) => {
      (m as unknown as Record<string, unknown>)[key as string] = val;
    });
    refresh();
  };

  const upgradeToPhysical = () => {
    const old = mat;
    const newMat = new THREE.MeshPhysicalMaterial();
    const keys: (keyof THREE.MeshStandardMaterial)[] = [
      "color","roughness","metalness","emissive","emissiveIntensity","opacity",
      "transparent","wireframe","flatShading","side","map","normalMap",
      "roughnessMap","metalnessMap","emissiveMap","aoMap","envMapIntensity",
    ];
    keys.forEach((k) => {
      try { (newMat as unknown as Record<string, unknown>)[k as string] = (old as unknown as Record<string, unknown>)[k as string]; } catch {}
    });
    mesh.material = newMat;
    store.setSnapshot(mesh.uuid, snapshotMaterial(newMat));
    const mesh2 = vpRefs.current.allMeshes.find((m) => m.uuid === uuid);
    if (mesh2) { vpRefs.current.highlightMap.delete(uuid!); applyHighlight(mesh2, vpRefs.current); }
    refresh();
  };

  const upgradeToStandard = () => {
    const old = mat;
    const newMat = new THREE.MeshStandardMaterial();
    const keys: (keyof THREE.MeshStandardMaterial)[] = [
      "color","roughness","metalness","emissive","emissiveIntensity","opacity",
      "transparent","wireframe","flatShading","side","map","normalMap",
      "roughnessMap","metalnessMap","emissiveMap","aoMap","envMapIntensity",
    ];
    keys.forEach((k) => {
      try { (newMat as unknown as Record<string, unknown>)[k as string] = (old as unknown as Record<string, unknown>)[k as string]; } catch {}
    });
    mesh.material = newMat;
    store.setSnapshot(mesh.uuid, snapshotMaterial(newMat));
    refresh();
  };

  return (
    <div className="p-3 space-y-0">
      {/* ── Base Color ── */}
      <SectionTitle>🎨 Base Color & Surface</SectionTitle>
      <ColorPicker
        label="Albedo Color"
        value={colorToHex(mat.color)}
        onChange={(hex) => { mat.color.set(hex); refresh(); }}
      />
      {isStandard && (
        <>
          <RangeRow label="Roughness" value={mat.roughness} onChange={(v) => set("roughness", v)} />
          <RangeRow label="Metalness" value={mat.metalness} onChange={(v) => set("metalness", v)} />
          <RangeRow label="Env Map Int." value={mat.envMapIntensity ?? 1} max={5} onChange={(v) => set("envMapIntensity", v)} />
        </>
      )}

      {/* ── Emissive ── */}
      <SectionTitle>✨ Emissive / Glow</SectionTitle>
      <ColorPicker
        label="Emissive Color"
        value={colorToHex(mat.emissive ?? new THREE.Color(0))}
        onChange={(hex) => { mat.emissive?.set(hex); refresh(); }}
      />
      <RangeRow label="Intensity" value={mat.emissiveIntensity ?? 1} min={0} max={10} onChange={(v) => set("emissiveIntensity", v)} />

      {/* ── Transparency ── */}
      <SectionTitle>💧 Transparency</SectionTitle>
      <Toggle label="Transparent" checked={mat.transparent} onChange={(v) => set("transparent", v)} />
      <RangeRow label="Opacity" value={mat.opacity ?? 1} onChange={(v) => set("opacity", v)} />
      {isPhysical && (
        <>
          <RangeRow label="Transmission" value={phys.transmission ?? 0} onChange={(v) => { phys.transmission = v; refresh(); }} />
          <RangeRow label="Thickness" value={phys.thickness ?? 0} min={0} max={10} step={0.05} onChange={(v) => { phys.thickness = v; refresh(); }} />
          <RangeRow label="IOR" value={(phys as {ior?: number}).ior ?? 1.5} min={1} max={2.5} step={0.01} onChange={(v) => { (phys as {ior?: number}).ior = v; refresh(); }} />
        </>
      )}

      {/* ── Rendering ── */}
      <SectionTitle>🔧 Rendering</SectionTitle>
      <Toggle label="Wireframe" checked={mat.wireframe ?? false} onChange={(v) => set("wireframe", v)} />
      <Toggle label="Flat Shading" checked={mat.flatShading ?? false} onChange={(v) => { set("flatShading", v); mat.needsUpdate = true; }} />
      <Toggle label="Depth Write" checked={mat.depthWrite !== false} onChange={(v) => set("depthWrite", v)} />
      <Toggle label="Visible" checked={mesh.visible} onChange={(v) => { mesh.visible = v; store.updateMeshVisibility(uuid!, v); }} />
      <Toggle label="Cast Shadow" checked={mesh.castShadow} onChange={(v) => { mesh.castShadow = v; refresh(); }} />
      <Toggle label="Receive Shadow" checked={mesh.receiveShadow} onChange={(v) => { mesh.receiveShadow = v; refresh(); }} />
      <SelectRow
        label="Side"
        value={mat.side ?? THREE.FrontSide}
        options={[
          { label: "Front Side", value: THREE.FrontSide },
          { label: "Back Side", value: THREE.BackSide },
          { label: "Double Side", value: THREE.DoubleSide },
        ]}
        onChange={(v) => set("side", parseInt(v) as THREE.Side)}
      />
      <SelectRow
        label="Blend Mode"
        value={mat.blending ?? THREE.NormalBlending}
        options={[
          { label: "Normal", value: THREE.NormalBlending },
          { label: "Additive", value: THREE.AdditiveBlending },
          { label: "Subtractive", value: THREE.SubtractiveBlending },
          { label: "Multiply", value: THREE.MultiplyBlending },
          { label: "No Blending", value: THREE.NoBlending },
        ]}
        onChange={(v) => set("blending", parseInt(v) as THREE.Blending)}
      />

      {/* ── Physical Extensions ── */}
      {isPhysical && (
        <>
          <SectionTitle>🔮 Clearcoat</SectionTitle>
          <RangeRow label="Clearcoat" value={phys.clearcoat ?? 0} onChange={(v) => { phys.clearcoat = v; refresh(); }} />
          <RangeRow label="CC Roughness" value={phys.clearcoatRoughness ?? 0} onChange={(v) => { phys.clearcoatRoughness = v; refresh(); }} />

          <SectionTitle>🧵 Sheen (Fabric)</SectionTitle>
          <RangeRow label="Sheen" value={phys.sheen ?? 0} onChange={(v) => { phys.sheen = v; refresh(); }} />
          <RangeRow label="Sheen Rough." value={phys.sheenRoughness ?? 1} onChange={(v) => { phys.sheenRoughness = v; refresh(); }} />
          <ColorPicker
            label="Sheen Color"
            value={colorToHex(phys.sheenColor ?? new THREE.Color(0xffffff))}
            onChange={(hex) => { if (phys.sheenColor) phys.sheenColor.set(hex); else phys.sheenColor = new THREE.Color(hex); refresh(); }}
          />

          <SectionTitle>🌈 Iridescence</SectionTitle>
          <RangeRow label="Iridescence" value={phys.iridescence ?? 0} onChange={(v) => { phys.iridescence = v; refresh(); }} />
          <RangeRow label="Irid. IOR" value={(phys as {iridescenceIOR?: number}).iridescenceIOR ?? 1.3} min={1} max={2.5} step={0.01} onChange={(v) => { (phys as {iridescenceIOR?: number}).iridescenceIOR = v; refresh(); }} />

          <SectionTitle>🫧 Anisotropy</SectionTitle>
          <RangeRow label="Anisotropy" value={(phys as {anisotropy?: number}).anisotropy ?? 0} min={-1} max={1} step={0.01} onChange={(v) => { (phys as {anisotropy?: number}).anisotropy = v; refresh(); }} />
        </>
      )}

      {/* ── Textures ── */}
      <SectionTitle>🖼 Textures</SectionTitle>
      {[
        { slot: "map", label: "Albedo Map" },
        { slot: "normalMap", label: "Normal Map" },
        { slot: "roughnessMap", label: "Roughness Map" },
        { slot: "metalnessMap", label: "Metalness Map" },
        { slot: "emissiveMap", label: "Emissive Map" },
        { slot: "aoMap", label: "AO Map" },
        { slot: "displacementMap", label: "Displacement Map" },
        { slot: "alphaMap", label: "Alpha Map" },
      ].map(({ slot, label }) => (
        <TexSlot key={slot} slot={slot} label={label} mat={mat} onUpdate={refresh} />
      ))}

      {/* Texture tiling */}
      {mat.map && (
        <>
          <SectionTitle>🔲 Texture Tiling</SectionTitle>
          <div className="flex gap-2 items-center mb-2">
            {(["x", "y"] as const).map((axis) => (
              <div key={axis} className="flex items-center gap-1.5 flex-1">
                <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${axis === "x" ? "text-[#f87]" : "text-[#8f8]"} bg-[#1e2235]`}>
                  {axis.toUpperCase()}
                </span>
                <input
                  type="number"
                  step={0.1}
                  value={mat.map!.repeat[axis].toFixed(2)}
                  className="flex-1 bg-[#1e2235] border border-[#2e3250] rounded text-[11px] text-[#ccd] px-2 py-1 outline-none"
                  onChange={(e) => {
                    if (mat.map) { mat.map.repeat[axis] = parseFloat(e.target.value) || 1; mat.map.needsUpdate = true; }
                    refresh();
                  }}
                />
              </div>
            ))}
          </div>
          <div className="flex gap-2 items-center mb-2">
            {(["x", "y"] as const).map((axis) => (
              <div key={axis} className="flex items-center gap-1.5 flex-1">
                <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${axis === "x" ? "text-[#f87]" : "text-[#8f8]"} bg-[#1e2235]`}>
                  O{axis.toUpperCase()}
                </span>
                <input
                  type="number"
                  step={0.01}
                  value={mat.map!.offset[axis].toFixed(3)}
                  className="flex-1 bg-[#1e2235] border border-[#2e3250] rounded text-[11px] text-[#ccd] px-2 py-1 outline-none"
                  onChange={(e) => {
                    if (mat.map) { mat.map.offset[axis] = parseFloat(e.target.value) || 0; mat.map.needsUpdate = true; }
                    refresh();
                  }}
                />
              </div>
            ))}
          </div>
        </>
      )}

      {/* ── Normal Scale ── */}
      {mat.normalMap && (
        <>
          <SectionTitle>📐 Normal Scale</SectionTitle>
          {(["x", "y"] as const).map((axis) => (
            <RangeRow
              key={axis}
              label={`Normal Scale ${axis.toUpperCase()}`}
              min={0}
              max={5}
              step={0.05}
              value={mat.normalScale?.[axis] ?? 1}
              onChange={(v) => { if (mat.normalScale) mat.normalScale[axis] = v; refresh(); }}
            />
          ))}
        </>
      )}

      {/* ── Material Type ── */}
      <SectionTitle>⚗️ Material Type</SectionTitle>
      <p className="text-[10px] text-[#556] mb-2">
        Current: <span className="text-[#7c8bff]">{mat.type}</span>
      </p>
      <div className="flex gap-2">
        <button
          onClick={upgradeToStandard}
          className="flex-1 bg-[#1e2235] border border-[#2e3250] rounded-md text-[11px] text-[#ccd] py-1.5 hover:border-[#5b6ef5] transition-colors"
        >
          → Standard
        </button>
        <button
          onClick={upgradeToPhysical}
          className="flex-1 bg-[#1e2235] border border-[#2e3250] rounded-md text-[11px] text-[#7c8bff] py-1.5 hover:border-[#5b6ef5] transition-colors"
        >
          → Physical
        </button>
      </div>
    </div>
  );
}
