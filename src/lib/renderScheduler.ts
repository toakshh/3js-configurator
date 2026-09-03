/**
 * On-demand rendering bridge.
 *
 * The viewport render loop only draws when something actually changed. Any code
 * that mutates the Three.js scene outside of React (materials, transforms,
 * textures, camera) calls `invalidate()` to schedule exactly one more frame.
 *
 * Lives in its own module so the store can import it without creating a cycle
 * with `useViewport`.
 */

let requestFrame: (() => void) | null = null;

/** Called once by the viewport to register its frame requester. */
export function setRenderRequester(fn: (() => void) | null) {
  requestFrame = fn;
}

/** Schedule one more rendered frame. Safe to call before the viewport exists. */
export function invalidate() {
  requestFrame?.();
}
