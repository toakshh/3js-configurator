"use client";

import dynamic from "next/dynamic";

// Must be client-only — Three.js uses browser APIs (WebGL, ResizeObserver, etc.)
const Configurator = dynamic(() => import("@/components/Configurator"), {
  ssr: false,
  loading: () => (
    <div className="flex h-screen w-screen items-center justify-center bg-[#0f1117] text-[#556] text-sm gap-3">
      <svg
        className="animate-spin"
        width={24}
        height={24}
        viewBox="0 0 24 24"
        fill="none"
        stroke="#5b6ef5"
        strokeWidth={2}
      >
        <path d="M21 12a9 9 0 11-6.219-8.56" />
      </svg>
      Loading GLB Configurator…
    </div>
  ),
});

export default function HomePage() {
  return <Configurator />;
}
