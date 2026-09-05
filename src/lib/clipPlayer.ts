/**
 * Playback for the animation clips that came inside a .glb.
 *
 * Deliberately small: it lists what the file contains and plays it. All the
 * Three.js state — the mixer, its actions, and the pose to restore on stop —
 * lives here rather than in React, and the viewport's render loop drives it one
 * frame at a time.
 *
 * React reads it through `subscribe`/`getSnapshot` (a `useSyncExternalStore`
 * source) so no store has to know animation exists. The playhead is
 * deliberately *not* part of that snapshot: it changes every frame, and putting
 * it there would re-render on every tick. Poll `getTime()` instead.
 */

import * as THREE from "three";
import { invalidate } from "@/lib/renderScheduler";

/** How long a switch between two clips takes to blend. */
const CROSSFADE_SECONDS = 0.25;

/**
 * Longest frame step playback will take in one go.
 *
 * Browsers throttle `requestAnimationFrame` in a background tab, so the delta
 * on the first frame back can be the whole time the tab was hidden. Handed to
 * the mixer unclamped that skips a clip to its end; clamping makes a hidden tab
 * pause rather than fast-forward.
 */
const MAX_FRAME_DELTA = 0.1;

export interface ClipInfo {
  index: number;
  name: string;
  duration: number;
}

export interface PlayerState {
  clips: ClipInfo[];
  activeIndex: number;
  playing: boolean;
  loop: boolean;
  speed: number;
  /** Length of the active clip in seconds, or 0 when nothing is loaded. */
  duration: number;
}

const EMPTY: PlayerState = {
  clips: [],
  activeIndex: -1,
  playing: false,
  loop: true,
  speed: 1,
  duration: 0,
};

// ─── state ────────────────────────────────────────────────────────────────

let root: THREE.Object3D | null = null;
let mixer: THREE.AnimationMixer | null = null;
let clips: THREE.AnimationClip[] = [];
let actions: THREE.AnimationAction[] = [];

let activeIndex = -1;
let playing = false;
let loop = true;
let speed = 1;

/** The pose the model arrived in, so Stop can put it back exactly. */
interface RestEntry {
  object: THREE.Object3D;
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
  scale: THREE.Vector3;
  morph: number[] | null;
}
let restPose: RestEntry[] = [];

/** Which objects each clip actually drives, resolved once at bind time. */
let animatedByClip: Set<THREE.Object3D>[] = [];
/** Pending "tidy up after the crossfade" timer, so switches can supersede it. */
let settleTimer: ReturnType<typeof setTimeout> | null = null;

// ─── external store plumbing ──────────────────────────────────────────────

const listeners = new Set<() => void>();
let snapshot: PlayerState = EMPTY;

function emit() {
  // Rebuilt only when something actually changed, so `getSnapshot` stays
  // referentially stable and React does not loop.
  snapshot = {
    clips: clips.map((c, index) => ({ index, name: c.name || `Clip ${index + 1}`, duration: c.duration })),
    activeIndex,
    playing,
    loop,
    speed,
    duration: activeIndex >= 0 ? clips[activeIndex]?.duration ?? 0 : 0,
  };
  listeners.forEach((l) => l());
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getSnapshot(): PlayerState {
  return snapshot;
}

/** Server render has no model, so the empty state is always correct there. */
export function getServerSnapshot(): PlayerState {
  return EMPTY;
}

/** Current playhead in seconds. Polled rather than pushed — see the header. */
export function getTime(): number {
  const action = actions[activeIndex];
  return action ? action.time : 0;
}

// ─── lifecycle ────────────────────────────────────────────────────────────

function captureRestPose(target: THREE.Object3D) {
  restPose = [];
  target.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    restPose.push({
      object: obj,
      position: obj.position.clone(),
      quaternion: obj.quaternion.clone(),
      scale: obj.scale.clone(),
      morph: mesh.morphTargetInfluences ? [...mesh.morphTargetInfluences] : null,
    });
  });
}

/**
 * Resolve the objects a clip writes to.
 *
 * Needed because the mixer never puts anything back: whatever the last action
 * wrote to a node stays there forever. Knowing which nodes a clip owns is what
 * lets the ones it does *not* own go back to their loaded pose.
 */
function animatedObjects(target: THREE.Object3D, clip: THREE.AnimationClip): Set<THREE.Object3D> {
  const set = new Set<THREE.Object3D>();
  for (const track of clip.tracks) {
    const { nodeName } = THREE.PropertyBinding.parseTrackName(track.name);
    const node = THREE.PropertyBinding.findNode(target, nodeName);
    if (node) set.add(node as THREE.Object3D);
  }
  return set;
}

/**
 * Put everything the given clip does not animate back to its loaded pose.
 *
 * Without this, playing a spin and then switching to a clip that says nothing
 * about that object leaves it parked at whatever rotation the spin stopped on —
 * which reads as a stuck limb, not a new animation.
 */
function restoreUntouched(index: number) {
  const owned = animatedByClip[index];
  if (!owned) return;
  for (const entry of restPose) {
    if (owned.has(entry.object)) continue;
    entry.object.position.copy(entry.position);
    entry.object.quaternion.copy(entry.quaternion);
    entry.object.scale.copy(entry.scale);
    const mesh = entry.object as THREE.Mesh;
    if (entry.morph && mesh.morphTargetInfluences) {
      for (let i = 0; i < entry.morph.length; i++) {
        mesh.morphTargetInfluences[i] = entry.morph[i];
      }
    }
  }
  invalidate();
}

function restoreRestPose() {
  for (const entry of restPose) {
    entry.object.position.copy(entry.position);
    entry.object.quaternion.copy(entry.quaternion);
    entry.object.scale.copy(entry.scale);
    const mesh = entry.object as THREE.Mesh;
    if (entry.morph && mesh.morphTargetInfluences) {
      for (let i = 0; i < entry.morph.length; i++) {
        mesh.morphTargetInfluences[i] = entry.morph[i];
      }
    }
  }
}

/**
 * Point the player at a freshly loaded model.
 *
 * An action is prepared for every clip up front — they are cheap while stopped,
 * and having them ready is what lets switching clips crossfade instead of
 * rebuilding bindings mid-motion.
 */
export function bindClips(nextRoot: THREE.Object3D | null, nextClips: THREE.AnimationClip[]) {
  disposePlayer();
  if (!nextRoot || nextClips.length === 0) {
    emit();
    return;
  }

  root = nextRoot;
  clips = nextClips;
  mixer = new THREE.AnimationMixer(nextRoot);
  actions = clips.map((clip) => {
    const action = mixer!.clipAction(clip);
    action.clampWhenFinished = true;
    return action;
  });

  captureRestPose(nextRoot);
  animatedByClip = clips.map((clip) => animatedObjects(nextRoot, clip));

  // A clip that runs out under "once" leaves the transport showing playback
  // that is not happening.
  mixer.addEventListener("finished", () => {
    playing = false;
    emit();
    invalidate();
  });

  activeIndex = 0;
  applyLoopMode();
  emit();
}

/** Stop everything and release the mixer. */
export function disposePlayer() {
  actions.forEach((a) => a.stop());
  restoreRestPose();
  if (mixer && root) mixer.uncacheRoot(root);
  if (settleTimer) clearTimeout(settleTimer);
  settleTimer = null;
  mixer = null;
  root = null;
  clips = [];
  actions = [];
  restPose = [];
  animatedByClip = [];
  activeIndex = -1;
  playing = false;
  emit();
}

// ─── transport ────────────────────────────────────────────────────────────

function applyLoopMode() {
  const mode = loop ? THREE.LoopRepeat : THREE.LoopOnce;
  for (const action of actions) {
    action.loop = mode;
    action.timeScale = speed;
    // A clip that already ran to its end under "once" stays disabled until it
    // is reset; re-enable so switching to loop takes effect immediately.
    if (loop) action.enabled = true;
  }
}

/**
 * Make a clip the active one.
 *
 * While something is already playing the change is crossfaded, which is the
 * difference between an animation set that reads as one performance and one
 * that snaps between poses on every click.
 */
export function select(index: number) {
  if (index < 0 || index >= actions.length || index === activeIndex) return;
  const next = actions[index];
  const prev = actions[activeIndex];

  next.enabled = true;
  next.setEffectiveTimeScale(speed);
  next.setEffectiveWeight(1);
  next.time = 0;

  if (settleTimer) clearTimeout(settleTimer);

  if (playing && prev) {
    next.play();
    prev.crossFadeTo(next, CROSSFADE_SECONDS, false);
    // Snapping the outgoing clip's nodes to rest now would pop mid-blend, so
    // the tidy-up waits until the fade has finished.
    settleTimer = setTimeout(() => {
      settleTimer = null;
      if (activeIndex === index) restoreUntouched(index);
    }, CROSSFADE_SECONDS * 1000);
  } else {
    prev?.stop();
    // A hard cut can go back to the loaded pose immediately.
    restoreUntouched(index);
    next.reset();
    next.paused = true;
    next.play();
    // Show the first frame of the new clip rather than leaving the model in
    // whatever pose the previous one ended on.
    mixer?.update(0);
  }

  activeIndex = index;
  applyLoopMode();
  emit();
  invalidate();
}

export function play() {
  const action = actions[activeIndex];
  if (!action) return;
  // Replaying a finished non-looping clip should start it over, not sit at the end.
  if (!loop && action.time >= action.getClip().duration - 1e-4) {
    action.reset();
  }
  action.enabled = true;
  action.paused = false;
  if (!action.isRunning()) action.play();
  playing = true;
  emit();
  invalidate();
}

export function pause() {
  const action = actions[activeIndex];
  if (action) action.paused = true;
  playing = false;
  emit();
  invalidate();
}

export function toggle() {
  if (playing) pause();
  else play();
}

/** Stop and return the model to the pose it was loaded in. */
export function stop() {
  actions.forEach((a) => a.stop());
  restoreRestPose();
  const action = actions[activeIndex];
  if (action) {
    action.reset();
    action.paused = true;
    action.play();
    mixer?.update(0);
  }
  playing = false;
  emit();
  invalidate();
}

export function seek(seconds: number) {
  const action = actions[activeIndex];
  if (!action || !mixer) return;
  const duration = action.getClip().duration;
  action.time = Math.max(0, Math.min(duration, seconds));
  action.paused = !playing;
  action.enabled = true;
  mixer.update(0);
  emit();
  invalidate();
}

export function setLoop(next: boolean) {
  loop = next;
  applyLoopMode();
  emit();
}

export function setSpeed(next: number) {
  speed = next;
  actions.forEach((a) => a.setEffectiveTimeScale(next));
  emit();
}

// ─── frame tick ───────────────────────────────────────────────────────────

/**
 * Advance playback by one frame.
 *
 * Returns true only while something is actually moving, which is what keeps the
 * viewport's on-demand render loop drawing for exactly as long as a clip is
 * running and no longer.
 */
export function tick(delta: number): boolean {
  if (!playing || !mixer) return false;
  mixer.update(Math.min(delta, MAX_FRAME_DELTA));
  return true;
}
