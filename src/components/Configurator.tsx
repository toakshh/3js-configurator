"use client";

import { useState, useRef, useEffect } from "react";
import LeftPanel from "./LeftPanel";
import RightPanel from "./RightPanel";
import { useViewport } from "@/hooks/useViewport";
import ViewportInner from "./ViewportInner";
import TopNavBar from "./TopNavBar";

export default function Configurator() {
  const [leftCollapsed, setLeftCollapsed] = useState(false);
  const [rightCollapsed, setRightCollapsed] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { refs, loadGLB, handleCanvasClick } = useViewport(canvasRef);

  // Keyboard shortcuts for panel toggling ([ and ])
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const active = document.activeElement;
      if (active && (active.tagName === "INPUT" || active.tagName === "TEXTAREA" || active.tagName === "SELECT")) return;
      if (e.key === "[") setLeftCollapsed((c) => !c);
      if (e.key === "]") setRightCollapsed((c) => !c);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden bg-[#0f1117]">
      {/* Top Nav Bar - only renders when model loaded */}
      <TopNavBar />

      <div className="flex flex-1 min-h-0 relative">
        {/* Left Panel */}
        <LeftPanel
          loadGLB={loadGLB}
          vpRefs={refs}
          collapsed={leftCollapsed}
          onToggle={() => setLeftCollapsed((c) => !c)}
        />

        {/* Main Viewport Container */}
        <div className="flex-1 relative h-full min-w-0 overflow-hidden bg-[#141620]">
          <ViewportInner
            canvasRef={canvasRef}
            handleCanvasClick={handleCanvasClick}
            loadGLB={loadGLB}
            vpRefs={refs}
          />
        </div>

        {/* Right Panel */}
        <RightPanel
          vpRefs={refs}
          collapsed={rightCollapsed}
          onToggle={() => setRightCollapsed((c) => !c)}
        />
      </div>
    </div>
  );
}
