"use client";

import { useRef } from "react";
import { useGLBStore } from "@/store/glbStore";

export default function DropZone({
  loadGLB,
}: {
  loadGLB: (f: File) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const meshCount = useGLBStore((s) => s.meshEntries.length);

  return (
    <div
      className="mx-3 mt-0 mb-1 border-2 border-dashed border-[#2e3250] rounded-lg p-4 text-center cursor-pointer
        hover:border-[#5b6ef5] hover:bg-[#5b6ef5]/5 transition-colors group"
      onClick={() => inputRef.current?.click()}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        const f = e.dataTransfer.files[0];
        if (f) loadGLB(f);
      }}
    >
      <input
        ref={inputRef}
        type="file"
        accept=".glb,.gltf"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) loadGLB(f);
        }}
      />
      <svg
        className="mx-auto mb-2 opacity-50 group-hover:opacity-80 transition-opacity"
        width={28}
        height={28}
        viewBox="0 0 24 24"
        fill="none"
        stroke="#7c8bff"
        strokeWidth={1.5}
      >
        <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M17 8l-5-5-5 5M12 3v12" />
      </svg>
      <p className="text-[11px] text-[#778]">
        <span className="text-[#7c8bff] font-semibold">Drop .glb</span> or{" "}
        <span className="text-[#7c8bff] font-semibold">click to browse</span>
      </p>
      {meshCount > 0 && (
        <p className="text-[10px] text-[#556] mt-1">
          {meshCount} mesh{meshCount !== 1 ? "es" : ""} loaded
        </p>
      )}
    </div>
  );
}
