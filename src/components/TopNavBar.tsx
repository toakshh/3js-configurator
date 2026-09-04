"use client";

import { useMemo } from "react";
import { useGLBStore } from "@/store/glbStore";
import { OPTIMIZATION_LEVELS, triangleCount } from "@/lib/optimizer";
import { formatBytes } from "@/lib/glbExport";

/**
 * Model-level summary. Every number here is measured from the real scene —
 * there is deliberately no projected "you could save X" figure, because the
 * only honest size number is one taken from an actual serialization.
 */
export default function TopNavBar() {
  const meshEntries = useGLBStore((s) => s.meshEntries);
  const modelName = useGLBStore((s) => s.modelName);
  const meshLevels = useGLBStore((s) => s.meshLevels);
  const baselineBytes = useGLBStore((s) => s.baselineBytes);
  const currentBytes = useGLBStore((s) => s.currentBytes);
  const measuring = useGLBStore((s) => s.measuring);
  const activeTab = useGLBStore((s) => s.activeTab);
  const setActiveTab = useGLBStore((s) => s.setActiveTab);
  const revision = useGLBStore((s) => s.revision);

  const triangles = useMemo(
    () => meshEntries.reduce((sum, e) => sum + triangleCount(e.mesh.geometry), 0),
    // geometry is swapped in place by the optimizer; revision is the signal
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [meshEntries, revision]
  );

  const optimizedCount = useMemo(
    () => meshEntries.filter((e) => meshLevels.has(e.uuid)).length,
    [meshEntries, meshLevels]
  );

  const appliedLabel = useMemo(() => {
    const ids = [...new Set(meshLevels.values())];
    if (ids.length === 0) return null;
    if (ids.length === 1) {
      return OPTIMIZATION_LEVELS.find((l) => l.id === ids[0])?.label ?? ids[0];
    }
    return "Mixed levels";
  }, [meshLevels]);

  if (meshEntries.length === 0) return null;

  const saved =
    baselineBytes !== null && currentBytes !== null ? baselineBytes - currentBytes : null;

  return (
    <div className="h-12 bg-[#1a1d27]/90 backdrop-blur border-b border-[#2e3250] flex items-center justify-between px-4 gap-4 shadow-md shrink-0">
      {/* Model identity */}
      <div className="flex items-center gap-3 min-w-0">
        <span className="text-[12px] font-semibold text-[#c8cef0] truncate max-w-[220px]" title={`${modelName}.glb`}>
          {modelName}.glb
        </span>
        <div className="w-px h-4 bg-[#2e3250] shrink-0" />
        <span className="text-[11px] text-[#556] whitespace-nowrap">
          {meshEntries.length} mesh{meshEntries.length !== 1 ? "es" : ""}
        </span>
        <span className="text-[11px] text-[#556] whitespace-nowrap font-mono">
          {triangles.toLocaleString()} tris
        </span>
      </div>

      {/* Optimization status */}
      <div className="flex items-center gap-3 min-w-0">
        {appliedLabel ? (
          <span className="text-[10.5px] font-medium text-[#7c8bff] bg-[#5b6ef5]/10 border border-[#5b6ef5]/25 px-2 py-1 rounded-md whitespace-nowrap">
            ⚡ {appliedLabel}
            {optimizedCount < meshEntries.length && ` · ${optimizedCount}/${meshEntries.length} meshes`}
          </span>
        ) : (
          <span className="text-[11px] text-[#3a4270] whitespace-nowrap">Not optimized</span>
        )}

        {activeTab !== "optimize" && (
          <button
            onClick={() => setActiveTab("optimize")}
            className="text-[11px] font-medium text-[#7880a8] hover:text-[#a0a8ff] border border-[#2e3250] hover:border-[#5b6ef5] px-2.5 py-1 rounded-md transition-colors whitespace-nowrap"
          >
            Open optimizer
          </button>
        )}
      </div>

      {/* Measured size */}
      <div className="flex items-center gap-2 justify-end min-w-[150px]">
        {measuring ? (
          <span className="text-[11px] text-[#5b6ef5] flex items-center gap-1.5">
            <svg className="animate-spin" width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <path d="M21 12a9 9 0 11-6.219-8.56" />
            </svg>
            Measuring…
          </span>
        ) : currentBytes !== null ? (
          <>
            {saved !== null && saved > 0 && baselineBytes !== null && (
              <span className="text-[11px] font-mono text-[#4a5280] line-through">
                {formatBytes(baselineBytes)}
              </span>
            )}
            <span className="text-[12px] font-mono font-medium text-[#c8cef0]">
              {formatBytes(currentBytes)}
            </span>
            {saved !== null && saved > 0 && (
              <span className="text-[11px] font-bold text-[#22c55e] font-mono">
                −{formatBytes(saved)}
              </span>
            )}
          </>
        ) : (
          <span className="text-[11px] text-[#3a4270]">size not measured</span>
        )}
      </div>
    </div>
  );
}
