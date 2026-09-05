"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import * as player from "@/lib/clipPlayer";

const SPEEDS = [0.25, 0.5, 1, 1.5, 2];

function formatTime(seconds: number): string {
  return `${seconds.toFixed(2)}s`;
}

/**
 * The playhead readout and scrub bar.
 *
 * Split out and driven by its own animation frame rather than React state: the
 * time changes every frame, and routing that through the store would re-render
 * the whole panel sixty times a second to move one div.
 */
function Playhead({ duration, playing }: { duration: number; playing: boolean }) {
  const fillRef = useRef<HTMLDivElement>(null);
  const labelRef = useRef<HTMLSpanElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let frame = 0;
    const paint = () => {
      const t = player.getTime();
      const pct = duration > 0 ? Math.min(100, (t / duration) * 100) : 0;
      if (fillRef.current) fillRef.current.style.width = `${pct}%`;
      if (labelRef.current) labelRef.current.textContent = formatTime(t);
      frame = requestAnimationFrame(paint);
    };
    paint();
    return () => cancelAnimationFrame(frame);
    // Re-armed when playback starts or stops so a paused scrub still repaints.
  }, [duration, playing]);

  const scrubTo = (clientX: number) => {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return;
    player.seek(((clientX - rect.left) / rect.width) * duration);
  };

  return (
    <div className="flex items-center gap-2">
      <div
        ref={trackRef}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          scrubTo(e.clientX);
        }}
        onPointerMove={(e) => {
          if (e.buttons === 1) scrubTo(e.clientX);
        }}
        title="Drag to scrub"
        className="relative flex-1 h-1.5 rounded-full bg-[#1a1f38] cursor-pointer"
      >
        <div
          ref={fillRef}
          className="absolute inset-y-0 left-0 rounded-full bg-[#5b6ef5] pointer-events-none"
          style={{ width: "0%" }}
        />
      </div>
      <span className="text-[9.5px] font-mono text-[#4a5280] tabular-nums shrink-0">
        <span ref={labelRef}>0.00s</span> / {formatTime(duration)}
      </span>
    </div>
  );
}

/**
 * Lists the animation clips found inside the loaded .glb and plays them.
 *
 * Renders nothing at all when the file has no animation, so a static model is
 * not asked to carry a transport it has no use for.
 */
export default function AnimationPanel() {
  const state = useSyncExternalStore(
    player.subscribe,
    player.getSnapshot,
    player.getServerSnapshot
  );
  const [collapsed, setCollapsed] = useState(false);

  // Space toggles playback, the way every other player works.
  useEffect(() => {
    if (state.clips.length === 0) return;
    const handler = (e: KeyboardEvent) => {
      const el = document.activeElement;
      if (el && ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName)) return;
      if (e.code !== "Space") return;
      e.preventDefault();
      player.toggle();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [state.clips.length]);

  if (state.clips.length === 0) return null;

  const active = state.clips[state.activeIndex];

  return (
    <div className="absolute left-3 bottom-14 z-20 w-[264px] rounded-xl border border-[#1e2440] bg-[#0b0e1c]/95 backdrop-blur shadow-xl shadow-black/40 overflow-hidden">
      {/* ── header ─────────────────────────────────────── */}
      <button
        onClick={() => setCollapsed((c) => !c)}
        className="w-full flex items-center gap-2 px-3 py-2 border-b border-[#1a1f38] hover:bg-[#10142a] transition-colors"
      >
        <span className="text-[11px] text-[#5b6ef5]">▶</span>
        <span className="text-[11px] font-semibold text-[#c8cef0]">Animations</span>
        <span className="text-[10px] font-mono text-[#3a4270]">{state.clips.length}</span>
        <span className="flex-1" />
        <span className="text-[8px] text-[#4a5280]">{collapsed ? "▲" : "▼"}</span>
      </button>

      {!collapsed && (
        <>
          {/* ── clip list ──────────────────────────────── */}
          <div className="max-h-[168px] overflow-y-auto scrollbar-thin">
            {state.clips.map((clip) => {
              const isActive = clip.index === state.activeIndex;
              const isPlaying = isActive && state.playing;
              return (
                <div
                  key={clip.index}
                  onClick={() => player.select(clip.index)}
                  className={`flex items-center gap-2 px-3 py-1.5 cursor-pointer border-l-2 transition-colors
                    ${isActive
                      ? "border-[#5b6ef5] bg-[#5b6ef5]/10"
                      : "border-transparent hover:bg-[#10142a]"
                    }`}
                >
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      if (isActive) player.toggle();
                      else {
                        player.select(clip.index);
                        player.play();
                      }
                    }}
                    title={isPlaying ? "Pause" : `Play ${clip.name}`}
                    aria-label={isPlaying ? "Pause" : `Play ${clip.name}`}
                    className="w-5 h-5 shrink-0 rounded border border-[#1e2440] bg-[#0d1020] text-[9px] text-[#7880a8] hover:text-[#a0a8ff] hover:border-[#5b6ef5]/60 flex items-center justify-center transition-colors"
                  >
                    {isPlaying ? "❚❚" : "▶"}
                  </button>
                  <span
                    className={`text-[11px] truncate flex-1 ${
                      isActive ? "text-[#a0a8ff]" : "text-[#c8cef0]"
                    }`}
                    title={clip.name}
                  >
                    {clip.name}
                  </span>
                  <span className="text-[9.5px] font-mono text-[#3a4270] shrink-0">
                    {clip.duration.toFixed(2)}s
                  </span>
                </div>
              );
            })}
          </div>

          {/* ── transport ──────────────────────────────── */}
          <div className="px-3 py-2 border-t border-[#1a1f38] bg-[#0a0d1c] space-y-2">
            <div className="flex items-center gap-1.5">
              <TBtn
                title={state.playing ? "Pause (Space)" : "Play (Space)"}
                onClick={() => player.toggle()}
                accent
              >
                {state.playing ? "❚❚" : "▶"}
              </TBtn>
              <TBtn title="Stop and reset the pose" onClick={() => player.stop()}>
                ■
              </TBtn>
              <TBtn
                title={state.loop ? "Looping — click to play once" : "Playing once — click to loop"}
                onClick={() => player.setLoop(!state.loop)}
                accent={state.loop}
              >
                ↻
              </TBtn>
              <span className="flex-1" />
              <select
                value={state.speed}
                onChange={(e) => player.setSpeed(Number(e.target.value))}
                title="Playback speed"
                aria-label="Playback speed"
                className="bg-[#0d1020] border border-[#1e2440] rounded px-1 py-0.5 text-[10px] text-[#c8cef0] outline-none focus:border-[#5b6ef5]"
              >
                {SPEEDS.map((s) => (
                  <option key={s} value={s}>
                    {s}×
                  </option>
                ))}
              </select>
            </div>

            <Playhead duration={active?.duration ?? 0} playing={state.playing} />
          </div>
        </>
      )}
    </div>
  );
}

function TBtn({
  children,
  onClick,
  title,
  accent,
}: {
  children: React.ReactNode;
  onClick: () => void;
  title: string;
  accent?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      aria-label={title}
      className={`px-2 py-1 rounded-md text-[10px] border transition-colors
        ${accent
          ? "border-[#5b6ef5] bg-[#5b6ef5]/20 text-[#a0a8ff] hover:bg-[#5b6ef5]/30"
          : "border-[#1e2440] bg-[#12152a] text-[#7880a8] hover:border-[#5b6ef5]/60 hover:text-[#a0a8ff]"
        }`}
    >
      {children}
    </button>
  );
}
