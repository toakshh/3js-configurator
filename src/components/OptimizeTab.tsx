"use client";

import { useEffect, useMemo, useState } from "react";
import * as THREE from "three";
import { toast } from "react-hot-toast";
import { useGLBStore } from "@/store/glbStore";
import {
  ViewportRefs,
  getMesh,
  invalidate,
  snapshotMeshes,
  refreshMeshStats,
} from "@/hooks/useViewport";
import {
  OPTIMIZATION_LEVELS,
  OptimizationLevel,
  LevelId,
  analyzeLevel,
  applyLevel,
  restoreOriginal,
  triangleCount,
} from "@/lib/optimizer";
import { formatBytes, remeasureModel as remeasure } from "@/lib/glbExport";

type Scope = "selection" | "model";

function compact(n: number): string {
  return n.toLocaleString();
}

// ─── Level card ───────────────────────────────────────────────────────────

function LevelCard({
  level,
  selected,
  disabled,
  reason,
  trianglesBefore,
  trianglesAfter,
  texturesResized,
  texturesDropped,
  blockedMeshes,
  onSelect,
}: {
  level: OptimizationLevel;
  selected: boolean;
  disabled: boolean;
  reason: string | null;
  trianglesBefore: number;
  trianglesAfter: number;
  texturesResized: number;
  texturesDropped: number;
  blockedMeshes: number;
  onSelect: () => void;
}) {
  const reduction =
    trianglesBefore > 0 ? Math.round((1 - trianglesAfter / trianglesBefore) * 100) : 0;

  return (
    <button
      onClick={onSelect}
      disabled={disabled}
      className={`w-full text-left rounded-xl border p-3 mb-2 transition-all
        ${disabled
          ? "border-[#13162a] bg-[#0a0d1c] opacity-50 cursor-not-allowed"
          : selected
          ? "border-[#5b6ef5] bg-[#5b6ef5]/10"
          : "border-[#1e2440] bg-[#12152a] hover:border-[#2e3660]"
        }`}
    >
      <div className="flex items-center gap-2 mb-1">
        <span
          className="w-2 h-2 rounded-full shrink-0"
          style={{ background: disabled ? "#2a3050" : level.accent }}
        />
        <span
          className={`text-[12px] font-semibold ${
            selected && !disabled ? "text-[#a0a8ff]" : "text-[#c8cef0]"
          }`}
        >
          {level.label}
        </span>
        {!disabled && reduction > 0 && (
          <span className="ml-auto text-[10px] font-mono text-[#22c55e] bg-[#22c55e]/10 border border-[#22c55e]/25 px-1.5 py-0.5 rounded">
            −{reduction}% tris
          </span>
        )}
      </div>

      <p className="text-[10.5px] text-[#4a5280] leading-snug mb-2">{level.blurb}</p>

      {disabled ? (
        <p className="text-[10px] text-[#3a4270] italic">{reason ?? "Not available"}</p>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          <Chip>
            {compact(trianglesBefore)} → {compact(trianglesAfter)} tris
          </Chip>
          <Chip>textures ≤ {level.maxTexture}px</Chip>
          {texturesResized > 0 && <Chip>{texturesResized} resized</Chip>}
          {texturesDropped > 0 && <Chip>{texturesDropped} dropped</Chip>}
          {level.flatShading && <Chip>flat shaded</Chip>}
          {blockedMeshes > 0 && (
            <Chip>{blockedMeshes} mesh geometry kept</Chip>
          )}
        </div>
      )}
    </button>
  );
}

function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-[9.5px] font-mono text-[#7880a8] bg-[#0d1020] border border-[#1e2440] px-1.5 py-0.5 rounded">
      {children}
    </span>
  );
}

// ─── Tab ──────────────────────────────────────────────────────────────────

export default function OptimizeTab({
  vpRefs,
}: {
  vpRefs: React.MutableRefObject<ViewportRefs>;
}) {
  const meshEntries = useGLBStore((s) => s.meshEntries);
  const selectedUUIDs = useGLBStore((s) => s.selectedUUIDs);
  const meshLevels = useGLBStore((s) => s.meshLevels);
  const baselineBytes = useGLBStore((s) => s.baselineBytes);
  const currentBytes = useGLBStore((s) => s.currentBytes);
  const measuring = useGLBStore((s) => s.measuring);
  const revision = useGLBStore((s) => s.revision);

  const [pickedScope, setScope] = useState<Scope>("model");
  const [pickedLevelId, setLevelId] = useState<LevelId>("medium");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);

  const selectionCount = selectedUUIDs.size;
  const hasModel = meshEntries.length > 0;

  // Derived rather than synced through an effect: a scope you can't act on
  // silently falls back instead of briefly rendering an impossible state.
  const scope: Scope = pickedScope === "selection" && selectionCount === 0 ? "model" : pickedScope;

  const targetMeshes = useMemo(() => {
    const uuids =
      scope === "selection" ? [...selectedUUIDs] : meshEntries.map((e) => e.uuid);
    return uuids
      .map((uuid) => getMesh(vpRefs.current, uuid))
      .filter((m): m is THREE.Mesh => !!m);
    // revision changes when geometry is swapped, so the analysis below refreshes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope, selectedUUIDs, meshEntries, vpRefs, revision]);

  const analyses = useMemo(() => {
    return OPTIMIZATION_LEVELS.map((level) => {
      const analysis = analyzeLevel(targetMeshes, level);
      // Re-running the level every target mesh already sits at would churn
      // through the work and change nothing — that is a button that lies.
      const alreadyApplied =
        targetMeshes.length > 0 && targetMeshes.every((m) => meshLevels.get(m.uuid) === level.id);
      if (alreadyApplied) {
        return { ...analysis, hasEffect: false, reason: "Already applied" };
      }
      return analysis;
    });
  }, [targetMeshes, meshLevels]);

  // Never leave a disabled level selected — that is what produces a button
  // that looks actionable but does nothing. Derived, so there is no frame in
  // which the picked level and the rendered button disagree.
  const picked = analyses.find((a) => a.level.id === pickedLevelId);
  const activeAnalysis =
    picked?.hasEffect ? picked : analyses.find((a) => a.hasEffect) ?? picked ?? analyses[0];
  const levelId = activeAnalysis?.level.id ?? pickedLevelId;

  const liveTriangles = useMemo(
    () => targetMeshes.reduce((sum, m) => sum + triangleCount(m.geometry), 0),
    [targetMeshes]
  );

  // Distinct reasons geometry is being left alone, for an honest explanation.
  const blocked = useMemo(() => {
    const reasons = new Set<string>();
    (analyses[0]?.perMesh ?? []).forEach((m) => {
      if (m.blocked) reasons.add(m.blocked);
    });
    return { count: analyses[0]?.blockedMeshes ?? 0, reasons: [...reasons] };
  }, [analyses]);

  const appliedLevels = useMemo(() => {
    const ids = new Set<LevelId>();
    targetMeshes.forEach((m) => {
      const id = meshLevels.get(m.uuid);
      if (id) ids.add(id);
    });
    return [...ids];
  }, [targetMeshes, meshLevels]);

  // Measure the pristine model the first time the user opens this tab.
  // Serializing the whole scene is expensive, so it is never done on load.
  const isActiveTab = useGLBStore((s) => s.activeTab === "optimize");
  useEffect(() => {
    if (!hasModel || !isActiveTab) return;
    if (useGLBStore.getState().baselineBytes !== null) return;
    const t = setTimeout(remeasure, 150);
    return () => clearTimeout(t);
  }, [hasModel, isActiveTab]);

  const runOptimize = async () => {
    if (!activeAnalysis?.hasEffect || busy) return;
    const meshes = targetMeshes;
    if (!meshes.length) return;

    setBusy(true);
    setProgress({ done: 0, total: meshes.length });
    const loading = toast.loading(`Applying ${activeAnalysis.level.label}…`);

    // Record the pre-optimization state so Ctrl+Z puts the geometry back.
    // pushHistoryImmediate skips gesture coalescing: one optimize, one step.
    useGLBStore
      .getState()
      .pushHistoryImmediate(snapshotMeshes(meshes.map((m) => m.uuid), vpRefs.current));

    try {
      const result = await applyLevel(meshes, activeAnalysis.level, (done, total) =>
        setProgress({ done, total })
      );

      const touched = new Set(meshes.map((m) => m.uuid));
      useGLBStore.getState().setMeshLevels([...touched], activeAnalysis.level.id);
      refreshMeshStats(touched);
      useGLBStore.getState().bumpRevision();
      invalidate();

      const skippedNote = result.skipped
        ? ` · ${result.skipped} mesh${result.skipped === 1 ? "" : "es"} skipped`
        : "";
      toast.success(
        `${activeAnalysis.level.label}: ${compact(result.trianglesBefore)} → ${compact(
          result.trianglesAfter
        )} triangles across ${result.meshCount} mesh${
          result.meshCount === 1 ? "" : "es"
        }${skippedNote}`,
        { id: loading, duration: 5000 }
      );
      // Size is measured after the fact, from the real scene. Nothing downloads.
      remeasure();
    } catch (err) {
      console.error(err);
      toast.error("Optimization failed — the model is unchanged", { id: loading });
    } finally {
      setBusy(false);
      setProgress(null);
    }
  };

  const runRevert = async () => {
    const meshes = targetMeshes;
    if (!meshes.some((m) => meshLevels.has(m.uuid))) return;

    // Restoring is undoable too.
    useGLBStore
      .getState()
      .pushHistoryImmediate(snapshotMeshes(meshes.map((m) => m.uuid), vpRefs.current));

    let restored = 0;
    meshes.forEach((mesh) => {
      if (restoreOriginal(mesh)) restored++;
    });
    if (!restored) return;

    const touched = new Set(meshes.map((m) => m.uuid));
    useGLBStore.getState().setMeshLevels([...touched], null);
    refreshMeshStats(touched);
    useGLBStore.getState().bumpRevision();
    invalidate();
    toast(`Restored ${restored} mesh${restored === 1 ? "" : "es"} to original`, { icon: "↺" });
    remeasure();
  };

  if (!hasModel) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3 p-8 text-center">
        <div className="w-14 h-14 rounded-2xl bg-[#1e2440] flex items-center justify-center">
          <svg width={26} height={26} viewBox="0 0 24 24" fill="none" stroke="#3a4270" strokeWidth={1.5}>
            <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
          </svg>
        </div>
        <p className="text-[13px] text-[#3a4270] font-medium">Nothing to optimize</p>
        <p className="text-[11px] text-[#2a3050]">Load a .glb file to begin</p>
      </div>
    );
  }

  const canRevert = appliedLevels.length > 0;
  const savedBytes =
    baselineBytes !== null && currentBytes !== null ? baselineBytes - currentBytes : null;

  return (
    <div className="px-5 pb-6 pt-2">
      {/* ── Scope ─────────────────────────────────────── */}
      <SectionTitle>Scope</SectionTitle>
      <div className="flex gap-1 bg-[#080a18] rounded-xl p-1 mb-4">
        <ScopeBtn
          active={scope === "model"}
          disabled={false}
          onClick={() => setScope("model")}
        >
          Entire model ({meshEntries.length})
        </ScopeBtn>
        <ScopeBtn
          active={scope === "selection"}
          // Offering "selected" with nothing selected is the false-button case.
          disabled={selectionCount === 0}
          onClick={() => setScope("selection")}
        >
          {selectionCount === 0 ? "Selected (none)" : `Selected (${selectionCount})`}
        </ScopeBtn>
      </div>
      {selectionCount === 0 && (
        <p className="text-[10px] text-[#3a4270] -mt-3 mb-4">
          Select meshes in the viewport or the list to optimize them individually.
        </p>
      )}

      {/* ── Current state ─────────────────────────────── */}
      <div className="grid grid-cols-2 gap-2 mb-5">
        <Stat label="Triangles now" value={compact(liveTriangles)} />
        <Stat
          label="Model size"
          value={
            measuring
              ? "measuring…"
              : currentBytes !== null
              ? formatBytes(currentBytes)
              : "—"
          }
          hint={
            savedBytes !== null && savedBytes > 0
              ? `−${formatBytes(savedBytes)} vs original`
              : baselineBytes !== null && currentBytes !== null
              ? "unchanged"
              : undefined
          }
        />
      </div>

      {appliedLevels.length > 0 && (
        <div className="mb-4 p-2.5 rounded-lg bg-[#5b6ef5]/10 border border-[#5b6ef5]/25">
          <p className="text-[10.5px] text-[#7c8bff]">
            {scope === "model" ? "Model" : "Selection"} currently optimized:{" "}
            <span className="font-semibold">
              {appliedLevels
                .map((id) => OPTIMIZATION_LEVELS.find((l) => l.id === id)?.label ?? id)
                .join(", ")}
            </span>
          </p>
          <p className="text-[9.5px] text-[#4a5280] mt-0.5">
            Levels re-derive from the original, so switching never stacks two lossy passes.
          </p>
        </div>
      )}

      {/* ── Levels ────────────────────────────────────── */}
      <SectionTitle>Level</SectionTitle>
      {blocked.count > 0 && (
        <p className="text-[10px] text-[#4a5280] mb-2 leading-relaxed">
          Geometry stays intact on {blocked.count} mesh
          {blocked.count === 1 ? "" : "es"} ({blocked.reasons.join(", ")}) — decimating
          those would break the model. Their textures are still optimized, and the
          triangle counts above already account for this.
        </p>
      )}
      {analyses.map((a) => (
        <LevelCard
          key={a.level.id}
          level={a.level}
          selected={levelId === a.level.id}
          disabled={!a.hasEffect || busy}
          reason={a.reason}
          trianglesBefore={a.trianglesBefore}
          trianglesAfter={a.trianglesAfter}
          texturesResized={a.texturesResized}
          texturesDropped={a.texturesDropped}
          blockedMeshes={a.blockedMeshes}
          onSelect={() => setLevelId(a.level.id)}
        />
      ))}

      {/* ── Actions ───────────────────────────────────── */}
      <div className="mt-5 space-y-2">
        {activeAnalysis?.hasEffect ? (
          <button
            onClick={runOptimize}
            disabled={busy}
            className="w-full bg-gradient-to-r from-[#5b6ef5] to-[#7c5bf5] hover:from-[#6b7eff] hover:to-[#8c6bff] text-white font-semibold py-3 rounded-xl text-[12.5px] transition-all shadow-lg shadow-[#5b6ef5]/20 flex items-center justify-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {busy ? (
              <>
                <svg className="animate-spin" width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
                  <path d="M21 12a9 9 0 11-6.219-8.56" />
                </svg>
                {progress ? `Optimizing ${progress.done}/${progress.total}…` : "Optimizing…"}
              </>
            ) : (
              <>
                <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
                  <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
                </svg>
                Optimize {scope === "model" ? "entire model" : `${selectionCount} selected`}
              </>
            )}
          </button>
        ) : (
          // No actionable work: state that plainly instead of showing a button
          // that would do nothing.
          <div className="w-full py-3 rounded-xl border border-[#13162a] bg-[#0a0d1c] text-center">
            <p className="text-[11.5px] text-[#3a4270]">
              {activeAnalysis?.reason ?? "Nothing to optimize at this level"}
            </p>
          </div>
        )}

        {canRevert && (
          <button
            onClick={runRevert}
            disabled={busy}
            className="w-full bg-[#12152a] border border-[#1e2440] hover:border-[#5b6ef5]/50 text-[#4a5280] hover:text-[#7880a8] py-2.5 rounded-xl text-[11.5px] font-medium transition-all disabled:opacity-50"
          >
            ↺ Restore {scope === "model" ? "model" : "selection"} to original
          </button>
        )}

        <p className="text-[10px] text-[#2a3050] text-center pt-1 leading-relaxed">
          Optimizing only changes the model in the viewport.
          <br />
          Use <span className="text-[#3a4270]">Export</span> when you want to download it.
        </p>
      </div>
    </div>
  );
}

// ─── Bits ─────────────────────────────────────────────────────────────────

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[10px] uppercase tracking-[0.12em] text-[#4a5280] font-semibold mt-4 mb-2 pb-2 border-b border-[#1e2440] first:mt-2">
      {children}
    </div>
  );
}

function ScopeBtn({
  children,
  active,
  disabled,
  onClick,
}: {
  children: React.ReactNode;
  active: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`flex-1 py-1.5 rounded-lg text-[11px] font-medium transition-all
        ${disabled
          ? "text-[#2a3050] cursor-not-allowed"
          : active
          ? "bg-[#5b6ef5] text-white shadow-lg shadow-[#5b6ef5]/25"
          : "text-[#3a4270] hover:text-[#7880a8]"
        }`}
    >
      {children}
    </button>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="bg-[#12152a] border border-[#1e2440] rounded-lg px-3 py-2">
      <p className="text-[9px] text-[#3a4270] uppercase tracking-wider">{label}</p>
      <p className="text-[12.5px] text-[#c8cef0] font-mono mt-0.5">{value}</p>
      {hint && <p className="text-[9.5px] text-[#22c55e] mt-0.5">{hint}</p>}
    </div>
  );
}
