"use client";

import * as THREE from "three";
import { useGLBStore } from "@/store/glbStore";
import { getMeshMat, setAllMats, colorToHex, snapshotMaterial, textureToDataURL, applySnapshot } from "@/lib/matUtils";
import { ViewportRefs } from "@/hooks/useViewport";
import { useCallback } from "react";

// ─── Design tokens ────────────────────────────────────────────────────────
const S = {
  section: "text-[10px] uppercase tracking-[0.12em] text-[#4a5280] font-semibold mt-6 mb-3 pb-2 border-b border-[#1e2440] flex items-center gap-2 first:mt-2",
  label: "text-[11.5px] text-[#7880a8] font-medium leading-none",
  value: "text-[11px] text-[#9ca3d4] tabular-nums",
  input: "w-full bg-[#12152a] border border-[#1e2440] rounded-lg text-[12px] text-[#c8cef0] px-3 py-2 outline-none focus:border-[#5b6ef5] focus:bg-[#14183a] transition-all placeholder:text-[#3a4060]",
  select: "w-full bg-[#12152a] border border-[#1e2440] rounded-lg text-[12px] text-[#c8cef0] px-3 py-2 outline-none focus:border-[#5b6ef5] transition-all cursor-pointer appearance-none",
};

function SectionTitle({ icon, children }: { icon?: string; children: React.ReactNode }) {
  return (
    <div className={S.section}>
      {icon && <span className="text-[13px]">{icon}</span>}
      <span>{children}</span>
    </div>
  );
}

function PropRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 mb-3">
      <span className={`${S.label} w-32 shrink-0`}>{label}</span>
      <div className="flex-1 min-w-0">{children}</div>
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
}: {
  label: string;
  min?: number;
  max?: number;
  step?: number;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="flex items-center gap-3 mb-3">
      <span className={`${S.label} w-32 shrink-0`}>{label}</span>
      <div className="flex-1 flex items-center gap-2.5">
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          className="flex-1 cursor-pointer h-[3px]"
          onChange={(e) => onChange(parseFloat(e.target.value))}
        />
        <span className="text-[11px] text-[#5b6ef5] font-mono w-10 text-right shrink-0">
          {value.toFixed(2)}
        </span>
      </div>
    </div>
  );
}

function ColorRow({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex items-center gap-3 mb-3">
      <span className={`${S.label} w-32 shrink-0`}>{label}</span>
      <div className="flex-1 flex items-center gap-2">
        <label className="relative cursor-pointer group flex-1">
          <input
            type="color"
            value={value}
            className="sr-only"
            onChange={(e) => onChange(e.target.value)}
          />
          <div
            className="h-8 w-full rounded-lg border border-[#1e2440] group-hover:border-[#5b6ef5] transition-colors flex items-center px-2.5 gap-2.5"
            style={{ background: `linear-gradient(135deg, ${value}dd 0%, ${value}88 100%)` }}
          >
            <div
              className="w-4 h-4 rounded-md border border-white/20 shrink-0"
              style={{ background: value }}
            />
            <span className="text-[11px] font-mono text-white/70 uppercase">{value}</span>
          </div>
        </label>
      </div>
    </div>
  );
}

function ToggleRow({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between mb-3">
      <span className={S.label}>{label}</span>
      <label className="relative w-9 h-5 cursor-pointer shrink-0">
        <input
          type="checkbox"
          className="sr-only peer"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
        />
        <span className="absolute inset-0 bg-[#1e2440] rounded-full transition-all duration-200 peer-checked:bg-[#5b6ef5]" />
        <span className="absolute left-0.5 top-0.5 w-4 h-4 bg-white rounded-full shadow transition-all duration-200 peer-checked:translate-x-4" />
      </label>
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
    <div className="flex items-center gap-3 mb-3">
      <span className={`${S.label} w-32 shrink-0`}>{label}</span>
      <div className="flex-1 relative">
        <select
          value={value}
          className={S.select}
          onChange={(e) => onChange(e.target.value)}
        >
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <div className="absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none text-[#4a5280] text-[10px]">
          ▾
        </div>
      </div>
    </div>
  );
}

// ─── Texture slot with preview ─────────────────────────────────────────────

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
  const tex = (mat as unknown as Record<string, unknown>)[slot] as THREE.Texture | null;
  const thumb = tex ? textureToDataURL(tex) : null;

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const url = URL.createObjectURL(file);
    new THREE.TextureLoader().load(url, (t) => {
      t.colorSpace =
        slot === "map" || slot === "emissiveMap"
          ? THREE.SRGBColorSpace
          : THREE.LinearSRGBColorSpace;
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      (mat as unknown as Record<string, unknown>)[slot] = t;
      mat.needsUpdate = true;
      URL.revokeObjectURL(url);
      onUpdate();
    });
    // reset so same file can be re-uploaded
    e.target.value = "";
  };

  const clearTex = (ev: React.MouseEvent) => {
    ev.stopPropagation();
    (mat as unknown as Record<string, unknown>)[slot] = null;
    mat.needsUpdate = true;
    onUpdate();
  };

  return (
    <div className="mb-3">
      <div className="flex items-center gap-2.5">
        {/* Thumbnail */}
        <div
          className="w-12 h-12 rounded-lg border border-[#1e2440] shrink-0 overflow-hidden bg-[#0d1020] flex items-center justify-center relative group/thumb"
          style={{
            backgroundImage: "repeating-conic-gradient(#1a1f35 0% 25%, #0d1020 0% 50%)",
            backgroundSize: "10px 10px",
          }}
        >
          {thumb ? (
            <img src={thumb} alt={label} className="w-full h-full object-cover" />
          ) : (
            <span className="text-[#2a3060] text-[18px]">□</span>
          )}
          {tex && (
            <button
              onClick={clearTex}
              className="absolute inset-0 bg-black/60 opacity-0 group-hover/thumb:opacity-100 transition-opacity flex items-center justify-center text-red-400 text-[11px] font-bold"
              title="Remove texture"
            >
              ✕
            </button>
          )}
        </div>

        {/* Info + upload */}
        <div className="flex-1 min-w-0">
          <p className={`${S.label} mb-1`}>{label}</p>
          <p className="text-[10px] text-[#3a4070] truncate mb-1.5">
            {tex ? (tex.name || "Custom texture") : "No texture"}
          </p>
          <label className="flex items-center gap-1.5 cursor-pointer">
            <input type="file" accept="image/*" className="hidden" onChange={handleFile} />
            <span className="text-[10px] bg-[#1e2440] hover:bg-[#252b55] border border-[#2e3660] hover:border-[#5b6ef5] text-[#7880a8] hover:text-[#a0a8ff] px-2.5 py-1 rounded-md transition-all">
              {tex ? "↺ Replace" : "↑ Upload"}
            </span>
            {tex && (
              <span className="text-[9px] text-[#4caf90] bg-[#4caf9015] border border-[#4caf9040] px-1.5 py-0.5 rounded">
                ✓ Applied
              </span>
            )}
          </label>
        </div>
      </div>
    </div>
  );
}

// ─── Multi-select banner ───────────────────────────────────────────────────

function MultiSelectBanner({
  count,
  onApplyAll,
}: {
  count: number;
  onApplyAll: () => void;
}) {
  if (count <= 1) return null;
  return (
    <div className="mx-4 mb-4 p-3 bg-[#5b6ef5]/10 border border-[#5b6ef5]/30 rounded-xl flex items-center gap-3">
      <span className="text-[20px]">⬡</span>
      <div className="flex-1 min-w-0">
        <p className="text-[11px] text-[#7c8bff] font-semibold">{count} meshes selected</p>
        <p className="text-[10px] text-[#4a5280] mt-0.5">Changes apply to all selected meshes</p>
      </div>
    </div>
  );
}

// ─── Empty state ──────────────────────────────────────────────────────────

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center h-full gap-4 p-8 text-center">
      <div className="w-14 h-14 rounded-2xl bg-[#1e2440] flex items-center justify-center">
        <svg width={28} height={28} viewBox="0 0 24 24" fill="none" stroke="#3a4270" strokeWidth={1.5}>
          <path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z" />
          <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
          <line x1="12" y1="22.08" x2="12" y2="12" />
        </svg>
      </div>
      <div>
        <p className="text-[13px] text-[#3a4270] font-medium">No mesh selected</p>
        <p className="text-[11px] text-[#2a3050] mt-1">Click a mesh in the viewport<br />or select from the list</p>
      </div>
    </div>
  );
}

// ─── Main Material Tab ────────────────────────────────────────────────────

export default function MaterialTab({
  vpRefs,
}: {
  vpRefs: React.MutableRefObject<ViewportRefs>;
}) {
  const store = useGLBStore();
  const uuid = store.selectedUUID;
  const selectedUUIDs = store.selectedUUIDs;

  const primaryMesh = uuid
    ? vpRefs.current.allMeshes.find((m) => m.uuid === uuid) ?? null
    : null;

  const refresh = useCallback(() => {
    store.setMeshEntries([...store.meshEntries]);
  }, [store]);

  // Record a history snapshot before a change
  const pushHistory = useCallback(() => {
    const step = new Map<string, ReturnType<typeof snapshotMaterial>>();
    selectedUUIDs.forEach((id) => {
      const mesh = vpRefs.current.allMeshes.find((m) => m.uuid === id);
      if (!mesh) return;
      const mat = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
      if (mat) step.set(id, snapshotMaterial(mat as THREE.Material));
    });
    store.pushHistory(step);
  }, [selectedUUIDs, vpRefs, store]);

  // Apply a property mutation to ALL selected meshes
  const setForAll = useCallback(
    (fn: (mat: THREE.MeshStandardMaterial) => void) => {
      selectedUUIDs.forEach((id) => {
        const mesh = vpRefs.current.allMeshes.find((m) => m.uuid === id);
        if (!mesh) return;
        setAllMats(mesh, fn);
      });
      refresh();
    },
    [selectedUUIDs, vpRefs, refresh]
  );

  if (!primaryMesh) return <EmptyState />;

  const mat = getMeshMat(primaryMesh);
  if (!mat) {
    return (
      <div className="p-6 text-[12px] text-[#3a4270]">No material on this mesh.</div>
    );
  }

  const isPhysical = mat.type === "MeshPhysicalMaterial";
  const isStandard = isPhysical || mat.type === "MeshStandardMaterial";
  const phys = mat as THREE.MeshPhysicalMaterial;
  const multiCount = selectedUUIDs.size;

  const set = <K extends keyof THREE.MeshStandardMaterial>(
    key: K,
    val: THREE.MeshStandardMaterial[K]
  ) => {
    setForAll((m) => {
      (m as unknown as Record<string, unknown>)[key as string] = val;
    });
  };

  const upgradeAll = (type: "standard" | "physical") => {
    pushHistory();
    selectedUUIDs.forEach((id) => {
      const mesh = vpRefs.current.allMeshes.find((m) => m.uuid === id);
      if (!mesh) return;
      const old = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
      if (!old) return;
      const newMat =
        type === "physical"
          ? new THREE.MeshPhysicalMaterial()
          : new THREE.MeshStandardMaterial();
      const keys: string[] = [
        "color","roughness","metalness","emissive","emissiveIntensity","opacity",
        "transparent","wireframe","flatShading","side","map","normalMap",
        "roughnessMap","metalnessMap","emissiveMap","aoMap","envMapIntensity",
      ];
      keys.forEach((k) => {
        try {
          (newMat as unknown as Record<string, unknown>)[k] =
            (old as unknown as Record<string, unknown>)[k];
        } catch {}
      });
      mesh.material = newMat;
      store.setSnapshot(id, snapshotMaterial(newMat));
    });
    refresh();
  };

  return (
    <div className="px-5 pb-6">
      <MultiSelectBanner count={multiCount} onApplyAll={() => {}} />

      {/* ── Base Color ──────────────────────────────── */}
      <SectionTitle icon="🎨">Base Color & Surface</SectionTitle>

      <ColorRow
        label="Albedo Color"
        value={colorToHex(mat.color)}
        onChange={(hex) => {
          pushHistory();
          setForAll((m) => m.color?.set(hex));
        }}
      />

      {isStandard && (
        <>
          <RangeRow
            label="Roughness"
            value={mat.roughness}
            onChange={(v) => { pushHistory(); set("roughness", v); }}
          />
          <RangeRow
            label="Metalness"
            value={mat.metalness}
            onChange={(v) => { pushHistory(); set("metalness", v); }}
          />
          <RangeRow
            label="Env Map Intensity"
            min={0} max={5}
            value={mat.envMapIntensity ?? 1}
            onChange={(v) => { pushHistory(); set("envMapIntensity", v); }}
          />
        </>
      )}

      {/* ── Emissive ────────────────────────────────── */}
      <SectionTitle icon="✨">Emissive / Glow</SectionTitle>

      <ColorRow
        label="Emissive Color"
        value={colorToHex(mat.emissive ?? new THREE.Color(0))}
        onChange={(hex) => {
          pushHistory();
          setForAll((m) => m.emissive?.set(hex));
        }}
      />
      <RangeRow
        label="Intensity"
        min={0} max={10}
        value={mat.emissiveIntensity ?? 1}
        onChange={(v) => { pushHistory(); set("emissiveIntensity", v); }}
      />

      {/* ── Transparency ────────────────────────────── */}
      <SectionTitle icon="💧">Transparency</SectionTitle>

      <ToggleRow
        label="Transparent"
        checked={mat.transparent}
        onChange={(v) => { pushHistory(); set("transparent", v); }}
      />
      <RangeRow
        label="Opacity"
        value={mat.opacity ?? 1}
        onChange={(v) => { pushHistory(); set("opacity", v); }}
      />
      {isPhysical && (
        <>
          <RangeRow
            label="Transmission"
            value={phys.transmission ?? 0}
            onChange={(v) => { pushHistory(); setForAll((m) => { (m as THREE.MeshPhysicalMaterial).transmission = v; }); }}
          />
          <RangeRow
            label="Thickness"
            min={0} max={10} step={0.05}
            value={phys.thickness ?? 0}
            onChange={(v) => { pushHistory(); setForAll((m) => { (m as THREE.MeshPhysicalMaterial).thickness = v; }); }}
          />
          <RangeRow
            label="IOR"
            min={1} max={2.5} step={0.01}
            value={(phys as { ior?: number }).ior ?? 1.5}
            onChange={(v) => { pushHistory(); setForAll((m) => { (m as unknown as { ior: number }).ior = v; }); }}
          />
        </>
      )}

      {/* ── Rendering ──────────────────────────────── */}
      <SectionTitle icon="🔧">Rendering</SectionTitle>

      <ToggleRow label="Wireframe" checked={mat.wireframe ?? false} onChange={(v) => { pushHistory(); set("wireframe", v); }} />
      <ToggleRow label="Flat Shading" checked={mat.flatShading ?? false} onChange={(v) => { pushHistory(); setForAll((m) => { m.flatShading = v; m.needsUpdate = true; }); }} />
      <ToggleRow label="Depth Write" checked={mat.depthWrite !== false} onChange={(v) => { pushHistory(); set("depthWrite", v); }} />
      <ToggleRow
        label="Visible"
        checked={primaryMesh.visible}
        onChange={(v) => {
          selectedUUIDs.forEach((id) => {
            const mesh = vpRefs.current.allMeshes.find((m) => m.uuid === id);
            if (mesh) mesh.visible = v;
            store.updateMeshVisibility(id, v);
          });
        }}
      />
      <ToggleRow
        label="Cast Shadow"
        checked={primaryMesh.castShadow}
        onChange={(v) => {
          selectedUUIDs.forEach((id) => {
            const mesh = vpRefs.current.allMeshes.find((m) => m.uuid === id);
            if (mesh) mesh.castShadow = v;
          });
          refresh();
        }}
      />
      <ToggleRow
        label="Receive Shadow"
        checked={primaryMesh.receiveShadow}
        onChange={(v) => {
          selectedUUIDs.forEach((id) => {
            const mesh = vpRefs.current.allMeshes.find((m) => m.uuid === id);
            if (mesh) mesh.receiveShadow = v;
          });
          refresh();
        }}
      />

      <SelectRow
        label="Side"
        value={mat.side ?? THREE.FrontSide}
        options={[
          { label: "Front Side", value: THREE.FrontSide },
          { label: "Back Side", value: THREE.BackSide },
          { label: "Double Side", value: THREE.DoubleSide },
        ]}
        onChange={(v) => { pushHistory(); set("side", parseInt(v) as THREE.Side); }}
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
        onChange={(v) => { pushHistory(); set("blending", parseInt(v) as THREE.Blending); }}
      />

      {/* ── Physical extensions ─────────────────────── */}
      {isPhysical && (
        <>
          <SectionTitle icon="🔮">Clearcoat</SectionTitle>
          <RangeRow label="Clearcoat" value={phys.clearcoat ?? 0} onChange={(v) => { pushHistory(); setForAll((m) => { (m as THREE.MeshPhysicalMaterial).clearcoat = v; }); }} />
          <RangeRow label="CC Roughness" value={phys.clearcoatRoughness ?? 0} onChange={(v) => { pushHistory(); setForAll((m) => { (m as THREE.MeshPhysicalMaterial).clearcoatRoughness = v; }); }} />

          <SectionTitle icon="🧵">Sheen (Fabric / Cloth)</SectionTitle>
          <RangeRow label="Sheen" value={phys.sheen ?? 0} onChange={(v) => { pushHistory(); setForAll((m) => { (m as THREE.MeshPhysicalMaterial).sheen = v; }); }} />
          <RangeRow label="Sheen Roughness" value={phys.sheenRoughness ?? 1} onChange={(v) => { pushHistory(); setForAll((m) => { (m as THREE.MeshPhysicalMaterial).sheenRoughness = v; }); }} />
          <ColorRow
            label="Sheen Color"
            value={colorToHex(phys.sheenColor ?? new THREE.Color(0xffffff))}
            onChange={(hex) => {
              pushHistory();
              setForAll((m) => {
                const pm = m as THREE.MeshPhysicalMaterial;
                if (pm.sheenColor) pm.sheenColor.set(hex);
                else pm.sheenColor = new THREE.Color(hex);
              });
            }}
          />

          <SectionTitle icon="🌈">Iridescence</SectionTitle>
          <RangeRow label="Iridescence" value={phys.iridescence ?? 0} onChange={(v) => { pushHistory(); setForAll((m) => { (m as THREE.MeshPhysicalMaterial).iridescence = v; }); }} />
          <RangeRow label="Irid. IOR" min={1} max={2.5} step={0.01} value={(phys as { iridescenceIOR?: number }).iridescenceIOR ?? 1.3} onChange={(v) => { pushHistory(); setForAll((m) => { (m as unknown as { iridescenceIOR: number }).iridescenceIOR = v; }); }} />

          <SectionTitle icon="🫧">Anisotropy</SectionTitle>
          <RangeRow label="Anisotropy" min={-1} max={1} step={0.01} value={(phys as { anisotropy?: number }).anisotropy ?? 0} onChange={(v) => { pushHistory(); setForAll((m) => { (m as unknown as { anisotropy: number }).anisotropy = v; }); }} />
        </>
      )}

      {/* ── Textures ──────────────────────────────────── */}
      <SectionTitle icon="🖼">Texture Maps</SectionTitle>

      <div className="space-y-1">
        {[
          { slot: "map", label: "Albedo / Base Color" },
          { slot: "normalMap", label: "Normal Map" },
          { slot: "roughnessMap", label: "Roughness Map" },
          { slot: "metalnessMap", label: "Metalness Map" },
          { slot: "emissiveMap", label: "Emissive Map" },
          { slot: "aoMap", label: "Ambient Occlusion" },
          { slot: "displacementMap", label: "Displacement Map" },
          { slot: "alphaMap", label: "Alpha Map" },
        ].map(({ slot, label }) => (
          <TexSlot key={slot} slot={slot} label={label} mat={mat} onUpdate={() => { pushHistory(); refresh(); }} />
        ))}
      </div>

      {/* ── Texture tiling ────────────────────────────── */}
      {mat.map && (
        <>
          <SectionTitle icon="🔲">Texture Tiling & Offset</SectionTitle>
          <div className="grid grid-cols-2 gap-2 mb-3">
            {(["x", "y"] as const).map((axis) => (
              <div key={`rep-${axis}`} className="flex flex-col gap-1">
                <span className="text-[10px] text-[#4a5280]">
                  Repeat {axis.toUpperCase()}
                </span>
                <div className="flex items-center gap-1.5">
                  <span
                    className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                      axis === "x" ? "text-[#ff8080] bg-[#ff808015]" : "text-[#80ff80] bg-[#80ff8015]"
                    }`}
                  >
                    {axis.toUpperCase()}
                  </span>
                  <input
                    type="number"
                    step={0.1}
                    value={mat.map!.repeat[axis].toFixed(2)}
                    className={`${S.input} py-1.5 text-[11px]`}
                    onChange={(e) => {
                      if (mat.map) { mat.map.repeat[axis] = parseFloat(e.target.value) || 1; mat.map.needsUpdate = true; }
                      refresh();
                    }}
                  />
                </div>
              </div>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-2 mb-3">
            {(["x", "y"] as const).map((axis) => (
              <div key={`off-${axis}`} className="flex flex-col gap-1">
                <span className="text-[10px] text-[#4a5280]">
                  Offset {axis.toUpperCase()}
                </span>
                <div className="flex items-center gap-1.5">
                  <span
                    className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                      axis === "x" ? "text-[#ff8080] bg-[#ff808015]" : "text-[#80ff80] bg-[#80ff8015]"
                    }`}
                  >
                    O{axis.toUpperCase()}
                  </span>
                  <input
                    type="number"
                    step={0.01}
                    value={mat.map!.offset[axis].toFixed(3)}
                    className={`${S.input} py-1.5 text-[11px]`}
                    onChange={(e) => {
                      if (mat.map) { mat.map.offset[axis] = parseFloat(e.target.value) || 0; mat.map.needsUpdate = true; }
                      refresh();
                    }}
                  />
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {/* Normal scale */}
      {mat.normalMap && (
        <>
          <SectionTitle icon="📐">Normal Map Scale</SectionTitle>
          {(["x", "y"] as const).map((axis) => (
            <RangeRow
              key={axis}
              label={`Scale ${axis.toUpperCase()}`}
              min={0} max={5} step={0.05}
              value={mat.normalScale?.[axis] ?? 1}
              onChange={(v) => {
                if (mat.normalScale) mat.normalScale[axis] = v;
                refresh();
              }}
            />
          ))}
        </>
      )}

      {/* ── Material type upgrade ─────────────────────── */}
      <SectionTitle icon="⚗️">Material Type</SectionTitle>
      <div className="flex items-center gap-2 mb-4">
        <div className="flex-1 bg-[#12152a] border border-[#1e2440] rounded-lg px-3 py-2">
          <p className="text-[10px] text-[#3a4270]">Current type</p>
          <p className="text-[12px] text-[#7c8bff] font-medium mt-0.5">{mat.type}</p>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <button
          onClick={() => upgradeAll("standard")}
          className="bg-[#12152a] border border-[#1e2440] hover:border-[#5b6ef5] hover:bg-[#1e2440] text-[#7880a8] hover:text-[#a0a8ff] text-[11px] font-medium py-2.5 rounded-lg transition-all"
        >
          → Standard
        </button>
        <button
          onClick={() => upgradeAll("physical")}
          className="bg-[#5b6ef5]/10 border border-[#5b6ef5]/30 hover:border-[#5b6ef5] hover:bg-[#5b6ef5]/20 text-[#7c8bff] text-[11px] font-medium py-2.5 rounded-lg transition-all"
        >
          → Physical ✦
        </button>
      </div>
    </div>
  );
}
