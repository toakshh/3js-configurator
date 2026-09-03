"use client";

import { useRef } from "react";
import Viewport from "./Viewport";
import LeftPanel from "./LeftPanel";
import RightPanel from "./RightPanel";
import { useViewport } from "@/hooks/useViewport";

// We need shared refs between LeftPanel, Viewport, and RightPanel.
// The canonical approach: hoist refs from a parent that owns the canvas ref.

export default function Configurator() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { refs, loadGLB, handleCanvasClick } = useViewport(canvasRef);

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-[#0f1117]">
      <LeftPanel loadGLB={loadGLB} vpRefs={refs} />
      <ViewportWithCanvas
        canvasRef={canvasRef}
        handleCanvasClick={handleCanvasClick}
        loadGLB={loadGLB}
        vpRefs={refs}
      />
      <RightPanel vpRefs={refs} />
    </div>
  );
}

// Thin wrapper so Viewport receives the already-created canvasRef
import { ViewportRefs } from "@/hooks/useViewport";
import ViewportInner from "./ViewportInner";

function ViewportWithCanvas({
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
  return (
    <ViewportInner
      canvasRef={canvasRef}
      handleCanvasClick={handleCanvasClick}
      loadGLB={loadGLB}
      vpRefs={vpRefs}
    />
  );
}
