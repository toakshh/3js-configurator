"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { toast } from "react-hot-toast";
import { useGLBStore } from "@/store/glbStore";
import { ViewportRefs } from "@/hooks/useViewport";
import { OPTIMIZATION_LEVELS, triangleCount } from "@/lib/optimizer";
import {
  compressGLB,
  downloadGLB,
  exportGLB,
  formatBytes,
  sanitizeFilename,
} from "@/lib/glbExport";

/**
 * The only place in the app that writes a file to disk. Optimizing never
 * downloads; the user names the model here and confirms explicitly.
 */
export default function ExportDialog({
  open,
  onClose,
  vpRefs,
}: {
  open: boolean;
  onClose: () => void;
  vpRefs: React.MutableRefObject<ViewportRefs>;
}) {
  const storedName = useGLBStore((s) => s.modelName);
  const setModelName = useGLBStore((s) => s.setModelName);
  const meshEntries = useGLBStore((s) => s.meshEntries);
  const meshLevels = useGLBStore((s) => s.meshLevels);
  const baselineBytes = useGLBStore((s) => s.baselineBytes);

  const [name, setName] = useState(storedName);
  const [exporting, setExporting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // The dialog is remounted per open (keyed by the caller), so `name` starts
  // from the stored model name without an effect syncing it.
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    }, 40);
    return () => clearTimeout(t);
  }, [open]);

  const triangles = meshEntries.reduce(
    (sum, e) => sum + triangleCount(e.mesh.geometry),
    0
  );

  const appliedLabels = [...new Set(meshLevels.values())]
    .map((id) => OPTIMIZATION_LEVELS.find((l) => l.id === id)?.label ?? id)
    .join(", ");

  const handleExport = async () => {
    const root = vpRefs.current.gltfRoot;
    if (!root) {
      toast.error("Load a GLB first");
      return;
    }
    const finalName = sanitizeFilename(name);
    setExporting(true);
    const loading = toast.loading("Building GLB…");
    try {
      const raw = await exportGLB(root);
      const packed = await compressGLB(raw);
      downloadGLB(packed, finalName);
      // Remember the name so the next export defaults to it.
      setModelName(finalName.replace(/\.glb$/i, ""));
      useGLBStore.getState().setCurrentBytes(packed.byteLength);
      toast.success(`Exported ${finalName} · ${formatBytes(packed.byteLength)}`, {
        id: loading,
        duration: 5000,
      });
      onClose();
    } catch (err) {
      console.error(err);
      toast.error("Export failed", { id: loading });
    } finally {
      setExporting(false);
    }
  };

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !exporting) onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose, exporting]);

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[99999] flex items-center justify-center"
      style={{
        backdropFilter: "blur(4px)",
        WebkitBackdropFilter: "blur(4px)",
        background: "rgba(8,10,24,0.75)",
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget && !exporting) onClose();
      }}
    >
      <div
        className="relative w-[420px] max-w-[calc(100vw-32px)] rounded-2xl border border-[#2a2f52] bg-[#0f1220] shadow-2xl shadow-black/60"
        style={{ animation: "dlg-in 0.18s cubic-bezier(.22,.68,0,1.2) both" }}
        role="dialog"
        aria-modal="true"
        aria-labelledby="export-title"
      >
        <div className="px-6 pt-6 pb-4">
          <h2 id="export-title" className="text-[15px] font-semibold text-[#d4d8f0]">
            Export model
          </h2>
          <p className="mt-1.5 text-[12.5px] text-[#6a718a]">
            Name the file before it downloads.
          </p>

          <label className="block mt-5 text-[10px] uppercase tracking-wider text-[#4a5280] font-semibold">
            File name
          </label>
          <div className="mt-1.5 flex items-center gap-2">
            <input
              ref={inputRef}
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !exporting) {
                  e.preventDefault();
                  handleExport();
                }
              }}
              placeholder="model"
              className="flex-1 bg-[#080a18] border border-[#1e2440] rounded-lg text-[13px] text-[#c8cef0] px-3 py-2 outline-none focus:border-[#5b6ef5] transition-colors placeholder:text-[#3a4060]"
            />
            <span className="text-[12px] font-mono text-[#4a5280] shrink-0">.glb</span>
          </div>
          <p className="mt-1.5 text-[10.5px] text-[#3a4270] font-mono break-all">
            saves as {sanitizeFilename(name)}
          </p>

          <div className="mt-5 grid grid-cols-2 gap-2">
            <Cell label="Meshes" value={meshEntries.length.toLocaleString()} />
            <Cell label="Triangles" value={triangles.toLocaleString()} />
          </div>
          {appliedLabels && (
            <p className="mt-2.5 text-[10.5px] text-[#7c8bff]">
              Optimized: <span className="font-semibold">{appliedLabels}</span>
              {baselineBytes !== null && (
                <span className="text-[#4a5280]">
                  {" "}
                  · original was {formatBytes(baselineBytes)}
                </span>
              )}
            </p>
          )}
        </div>

        <div className="h-px bg-[#1a1f38]" />

        <div className="flex items-center justify-end gap-2 px-6 py-4">
          <button
            onClick={onClose}
            disabled={exporting}
            className="px-4 py-2 rounded-lg text-[12px] font-medium text-[#5a6080] hover:text-[#9098b8] bg-transparent hover:bg-[#1a1f38] border border-[#1e2440] hover:border-[#2e3462] transition-all outline-none focus:border-[#5b6ef5] disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={handleExport}
            disabled={exporting || !name.trim()}
            className="px-4 py-2 rounded-lg text-[12px] font-semibold bg-[#5b6ef5] hover:bg-[#6b7eff] text-white shadow-lg shadow-[#5b6ef5]/20 transition-all outline-none disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
          >
            {exporting && (
              <svg className="animate-spin" width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
                <path d="M21 12a9 9 0 11-6.219-8.56" />
              </svg>
            )}
            {exporting ? "Exporting…" : "Download .glb"}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

function Cell({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-[#080a18] border border-[#1a1f38] rounded-lg px-3 py-2">
      <p className="text-[9px] text-[#3a4270] uppercase tracking-wider">{label}</p>
      <p className="text-[12.5px] text-[#c8cef0] font-mono mt-0.5">{value}</p>
    </div>
  );
}
