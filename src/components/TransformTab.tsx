"use client";

import { useGLBStore } from "@/store/glbStore";
import { ViewportRefs, getMesh } from "@/hooks/useViewport";

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 text-[10px] uppercase tracking-widest text-[#556] mt-4 mb-2 pb-1 border-b border-[#1e2235] first:mt-1">
      {children}
    </div>
  );
}

function XYZRow({
  label,
  values,
  step = 0.01,
  onChange,
  precision = 4,
}: {
  label: string;
  values: [number, number, number];
  step?: number;
  onChange: (axis: 0 | 1 | 2, val: number) => void;
  precision?: number;
}) {
  const axes = ["X", "Y", "Z"] as const;
  const colors = ["text-[#f87]", "text-[#8f8]", "text-[#78f]"];
  return (
    <div className="mb-3">
      <p className="text-[10px] text-[#778] mb-1">{label}</p>
      <div className="grid grid-cols-3 gap-1.5">
        {axes.map((ax, i) => (
          <div key={ax} className="flex items-center gap-1">
            <span className={`text-[10px] font-bold ${colors[i]} bg-[#1e2235] px-1.5 py-0.5 rounded shrink-0`}>
              {ax}
            </span>
            <input
              type="number"
              step={step}
              value={values[i].toFixed(precision)}
              className="w-full bg-[#1e2235] border border-[#2e3250] rounded text-[11px] text-[#ccd] px-1.5 py-1 outline-none focus:border-[#5b6ef5]"
              onChange={(e) => onChange(i as 0 | 1 | 2, parseFloat(e.target.value) || 0)}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

export default function TransformTab({
  vpRefs,
}: {
  vpRefs: React.MutableRefObject<ViewportRefs>;
}) {
  const uuid = useGLBStore((s) => s.selectedUUID);
  // Transforms live on the Three.js object; `revision` is what tells this
  // component the numbers it displays have changed.
  useGLBStore((s) => s.revision);
  const refresh = useGLBStore((s) => s.bumpRevision);
  const mesh = uuid ? getMesh(vpRefs.current, uuid) : null;

  if (!mesh) {
    return (
      <div className="flex items-center justify-center h-full text-[#445] text-xs p-6 text-center">
        Select a mesh to edit its transform
      </div>
    );
  }

  const rad2deg = (r: number) => r * (180 / Math.PI);
  const deg2rad = (d: number) => d * (Math.PI / 180);

  const syncUniform = () => {
    mesh.scale.set(mesh.scale.x, mesh.scale.x, mesh.scale.x);
    refresh();
  };

  return (
    <div className="p-3">
      <SectionTitle>📍 Position</SectionTitle>
      <XYZRow
        label=""
        values={[mesh.position.x, mesh.position.y, mesh.position.z]}
        step={0.01}
        precision={4}
        onChange={(i, v) => {
          mesh.position.setComponent(i, v);
          refresh();
        }}
      />

      <SectionTitle>🔄 Rotation (degrees)</SectionTitle>
      <XYZRow
        label=""
        values={[
          parseFloat(rad2deg(mesh.rotation.x).toFixed(2)),
          parseFloat(rad2deg(mesh.rotation.y).toFixed(2)),
          parseFloat(rad2deg(mesh.rotation.z).toFixed(2)),
        ]}
        step={1}
        precision={2}
        onChange={(i, v) => {
          const axes: ("x" | "y" | "z")[] = ["x", "y", "z"];
          mesh.rotation[axes[i]] = deg2rad(v);
          refresh();
        }}
      />

      <SectionTitle>⇲ Scale</SectionTitle>
      <XYZRow
        label=""
        values={[mesh.scale.x, mesh.scale.y, mesh.scale.z]}
        step={0.01}
        precision={4}
        onChange={(i, v) => {
          mesh.scale.setComponent(i, v);
          refresh();
        }}
      />
      <button
        onClick={syncUniform}
        className="w-full mb-3 bg-[#1e2235] border border-[#2e3250] rounded-md text-[11px] text-[#ccd] py-1.5 hover:border-[#5b6ef5] transition-colors"
      >
        🔗 Uniform Scale (from X)
      </button>

      <SectionTitle>🎯 Render Order</SectionTitle>
      <div className="flex items-center gap-2 mb-3">
        <span className="text-[11px] text-[#778] w-28 shrink-0">Render Order</span>
        <input
          type="number"
          step={1}
          value={mesh.renderOrder}
          className="flex-1 bg-[#1e2235] border border-[#2e3250] rounded text-[11px] text-[#ccd] px-2 py-1 outline-none focus:border-[#5b6ef5]"
          onChange={(e) => { mesh.renderOrder = parseInt(e.target.value) || 0; refresh(); }}
        />
      </div>

      <SectionTitle>📦 Quick Reset</SectionTitle>
      <div className="grid grid-cols-3 gap-2">
        {[
          { label: "↺ Position", fn: () => mesh.position.set(0, 0, 0) },
          { label: "↺ Rotation", fn: () => mesh.rotation.set(0, 0, 0) },
          { label: "↺ Scale", fn: () => mesh.scale.set(1, 1, 1) },
        ].map(({ label, fn }) => (
          <button
            key={label}
            onClick={() => { fn(); refresh(); }}
            className="bg-[#1e2235] border border-[#2e3250] rounded-md text-[11px] text-[#ccd] py-1.5 hover:border-[#5b6ef5] transition-colors"
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}
