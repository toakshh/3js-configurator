"use client";

import { useEffect, useRef, useCallback } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { LineSegments2 } from "three/examples/jsm/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "three/examples/jsm/lines/LineSegmentsGeometry.js";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";
import { useGLBStore, MeshEntry, HistoryStep, MaterialSnapshot } from "@/store/glbStore";
import { snapshotMaterial, applySnapshot } from "@/lib/matUtils";
import { invalidate, setRenderRequester } from "@/lib/renderScheduler";

export { invalidate } from "@/lib/renderScheduler";

// ─── Types ───────────────────────────────────────────────────────────────

export interface ViewportRefs {
  renderer: THREE.WebGLRenderer | null;
  scene: THREE.Scene | null;
  perspCamera: THREE.PerspectiveCamera | null;
  orthoCamera: THREE.OrthographicCamera | null;
  controls: OrbitControls | null;
  grid: THREE.GridHelper | null;
  roomEnvTex: THREE.Texture | null;
  gltfRoot: THREE.Group | null;
  allMeshes: THREE.Mesh[];
  /** uuid → mesh, so hot paths look up in O(1) instead of scanning allMeshes. */
  meshMap: Map<string, THREE.Mesh>;
  selectedUUID: string | null;

  // Selection outline system (added directly to main scene)
  outlineGroup: THREE.Group;
  outlineLines: Map<string, LineSegments2>;
  outlineMaterial: LineMaterial;
}

/** O(1) mesh lookup by uuid. */
export function getMesh(r: ViewportRefs, uuid: string): THREE.Mesh | null {
  return r.meshMap.get(uuid) ?? null;
}

// ─── Disposal ─────────────────────────────────────────────────────────────

function disposeMaterial(mat: THREE.Material) {
  // Textures hang off the material as plain properties; dispose whatever we
  // find so GPU memory is released along with the material itself.
  for (const value of Object.values(mat)) {
    if (value && (value as THREE.Texture).isTexture) {
      (value as THREE.Texture).dispose();
    }
  }
  mat.dispose();
}

/** Release every GPU resource held by a subtree (geometries, materials, textures). */
export function disposeObject3D(root: THREE.Object3D) {
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (mesh.geometry) mesh.geometry.dispose();
    if (!mesh.material) return;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    mats.forEach(disposeMaterial);
  });
}

// ─── Outline helpers ──────────────────────────────────────────────────────

function createOutlineMaterial(): LineMaterial {
  return new LineMaterial({
    color: 0xffffff,
    linewidth: 1, // extremely thin
    dashed: true,
    dashScale: 1,
    dashSize: 0.1,
    gapSize: 0.1,
    dashOffset: 0,
    transparent: true,
    opacity: 0.35, // very faint
    depthTest: true, // respects depth so it does not draw over the front of the geometry
    resolution: new THREE.Vector2(
      typeof window !== "undefined" ? window.innerWidth : 1920,
      typeof window !== "undefined" ? window.innerHeight : 1080
    ),
  });
}

function addOutline(uuid: string, mesh: THREE.Mesh, r: ViewportRefs) {
  if (r.outlineLines.has(uuid)) return;

  mesh.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(mesh);
  if (box.isEmpty()) return;

  const min = box.min;
  const max = box.max;
  const size = box.getSize(new THREE.Vector3());

  // Add 2% padding so the box sits clearly outside the mesh and doesn't intersect
  const dx = Math.max(size.x * 0.02, 0.01);
  const dy = Math.max(size.y * 0.02, 0.01);
  const dz = Math.max(size.z * 0.02, 0.01);

  const x0 = min.x - dx, x1 = max.x + dx;
  const y0 = min.y - dy, y1 = max.y + dy;
  const z0 = min.z - dz, z1 = max.z + dz;

  const vertices = [
    // Bottom face
    x0, y0, z0,  x1, y0, z0,
    x1, y0, z0,  x1, y0, z1,
    x1, y0, z1,  x0, y0, z1,
    x0, y0, z1,  x0, y0, z0,
    // Top face
    x0, y1, z0,  x1, y1, z0,
    x1, y1, z0,  x1, y1, z1,
    x1, y1, z1,  x0, y1, z1,
    x0, y1, z1,  x0, y1, z0,
    // Vertical edges
    x0, y0, z0,  x0, y1, z0,
    x1, y0, z0,  x1, y1, z0,
    x1, y0, z1,  x1, y1, z1,
    x0, y0, z1,  x0, y1, z1,
  ];

  const segGeom = new LineSegmentsGeometry();
  segGeom.setPositions(vertices);

  const line = new LineSegments2(segGeom, r.outlineMaterial);
  line.computeLineDistances();
  // Bounding box is already in world space
  line.matrixAutoUpdate = false;
  line.matrix.identity();
  r.outlineGroup.add(line);
  r.outlineLines.set(uuid, line);
}

function removeOutline(uuid: string, r: ViewportRefs) {
  const line = r.outlineLines.get(uuid);
  if (line) {
    r.outlineGroup.remove(line);
    line.geometry.dispose();
    r.outlineLines.delete(uuid);
  }
}

function clearAllOutlines(r: ViewportRefs) {
  const uuids = [...r.outlineLines.keys()];
  uuids.forEach((uuid) => removeOutline(uuid, r));
}

function updateOutlines(r: ViewportRefs) {
  const selected = useGLBStore.getState().selectedUUIDs;
  // Remove deselected
  r.outlineLines.forEach((_, uuid) => {
    if (!selected.has(uuid)) {
      removeOutline(uuid, r);
    }
  });
  // Add newly selected
  selected.forEach((uuid) => {
    const mesh = getMesh(r, uuid);
    if (mesh && !r.outlineLines.has(uuid)) {
      addOutline(uuid, mesh, r);
    }
  });
  // Sync existing outline matrices to mesh transforms
  r.outlineLines.forEach((line, uuid) => {
    const mesh = getMesh(r, uuid);
    if (mesh) {
      mesh.updateMatrixWorld(true);
      line.matrix.copy(mesh.matrixWorld);
    }
  });
  invalidate();
}

function animateOutlines(r: ViewportRefs) {
  if (!r.outlineMaterial) return;
  r.outlineMaterial.dashOffset -= 0.08;
  if (r.outlineMaterial.dashOffset < -10) r.outlineMaterial.dashOffset = 0;
}

// ─── Main Hook ────────────────────────────────────────────────────────────

export function useViewport(canvasRef: React.RefObject<HTMLCanvasElement | null>) {
  // Lazy init: a useRef *initializer* is evaluated on every render, so the old
  // form allocated and threw away a Group and a shader LineMaterial each time.
  const refsRef = useRef<ViewportRefs | null>(null);
  refsRef.current ??= {
    renderer: null,
    scene: null,
    perspCamera: null,
    orthoCamera: null,
    controls: null,
    grid: null,
    roomEnvTex: null,
    gltfRoot: null,
    allMeshes: [],
    meshMap: new Map(),
    selectedUUID: null,

    outlineGroup: new THREE.Group(),
    outlineLines: new Map(),
    outlineMaterial: createOutlineMaterial(),
  };
  const refs = refsRef as React.MutableRefObject<ViewportRefs>;
  const animFrameRef = useRef<number>(0);

  // Only the selection set drives an effect here; every other store read goes
  // through getState(), so this hook never re-runs on unrelated UI state.
  const selectedUUIDs = useGLBStore((s) => s.selectedUUIDs);

  // ─── Init Three.js once ───────────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const parent = canvas.parentElement!;

    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    refs.current.renderer = renderer;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x141620);
    refs.current.scene = scene;
    useGLBStore.getState().setScene(scene);

    // Add outline group directly to main scene
    scene.add(refs.current.outlineGroup);

    const aspect = parent.clientWidth / parent.clientHeight;
    const perspCamera = new THREE.PerspectiveCamera(45, aspect, 0.001, 100000);
    perspCamera.position.set(3, 2, 5);
    refs.current.perspCamera = perspCamera;

    const orthoCamera = new THREE.OrthographicCamera(
      -5 * aspect, 5 * aspect, 5, -5, 0.001, 100000
    );
    orthoCamera.position.set(3, 2, 5);
    refs.current.orthoCamera = orthoCamera;

    const controls = new OrbitControls(perspCamera, canvas);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    refs.current.controls = controls;

    const pmremGen = new THREE.PMREMGenerator(renderer);
    pmremGen.compileEquirectangularShader();
    const roomEnv = new RoomEnvironment();
    const roomEnvTex = pmremGen.fromScene(roomEnv).texture;
    roomEnv.dispose();
    pmremGen.dispose();
    refs.current.roomEnvTex = roomEnvTex;
    scene.environment = roomEnvTex;

    const grid = new THREE.GridHelper(20, 20, 0x334466, 0x222233);
    scene.add(grid);
    refs.current.grid = grid;

    // Rich multi-directional lighting
    const ambient = new THREE.AmbientLight(0xffffff, 0.8);
    scene.add(ambient);

    const hemiLight = new THREE.HemisphereLight(0xffffff, 0x444455, 0.6);
    hemiLight.position.set(0, 50, 0);
    scene.add(hemiLight);

    const dirLight1 = new THREE.DirectionalLight(0xffffff, 1.5);
    dirLight1.position.set(10, 20, 15);
    dirLight1.castShadow = true;
    dirLight1.shadow.mapSize.set(2048, 2048);
    scene.add(dirLight1);

    const dirLight2 = new THREE.DirectionalLight(0x8090ff, 0.8);
    dirLight2.position.set(-10, 10, -15);
    scene.add(dirLight2);

    // ─── On-demand rendering ────────────────────────────────────────────
    // The loop draws only when something changed: a store update, an explicit
    // invalidate(), camera motion, or the selection outline dash animation.
    let needsRender = true;
    setRenderRequester(() => {
      needsRender = true;
    });
    // Any store change can affect what is on screen, so ask for one frame.
    const unsubscribe = useGLBStore.subscribe(() => {
      needsRender = true;
    });

    const ro = new ResizeObserver(() => {
      const w = parent.clientWidth;
      const h = parent.clientHeight;
      renderer.setSize(w, h);
      perspCamera.aspect = w / h;
      perspCamera.updateProjectionMatrix();
      const a = w / h;
      orthoCamera.left = -5 * a;
      orthoCamera.right = 5 * a;
      orthoCamera.updateProjectionMatrix();
      refs.current.outlineMaterial.resolution.set(w, h);
      needsRender = true;
    });
    ro.observe(parent);
    renderer.setSize(parent.clientWidth, parent.clientHeight);

    function animate() {
      animFrameRef.current = requestAnimationFrame(animate);

      const cameraMoved = controls.update();
      // The dashed outline only animates while something is selected.
      const hasOutlines = refs.current.outlineLines.size > 0;
      if (hasOutlines) animateOutlines(refs.current);

      if (!needsRender && !cameraMoved && !hasOutlines) return;
      needsRender = false;

      const cam =
        useGLBStore.getState().cameraMode === "ortho" ? orthoCamera : perspCamera;
      // Single render pass for the whole scene
      renderer.render(scene, cam);
    }
    animate();

    const r = refs.current;
    return () => {
      cancelAnimationFrame(animFrameRef.current);
      ro.disconnect();
      unsubscribe();
      setRenderRequester(null);
      controls.dispose();
      clearAllOutlines(r);
      r.outlineMaterial.dispose();
      disposeObject3D(scene);
      roomEnvTex.dispose();
      renderer.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ─── Sync outlines with selection ──────────────────────────────────────
  useEffect(() => {
    updateOutlines(refs.current);
  }, [selectedUUIDs, refs]);

  // ─── Load GLB ─────────────────────────────────────────────────────────
  const loadGLB = useCallback((file: File) => {
    const r = refs.current;
    if (!r.scene) return;
    const store = useGLBStore.getState();

    const url = URL.createObjectURL(file);
    const loader = new GLTFLoader();
    loader.load(
      url,
      (gltf) => {
        URL.revokeObjectURL(url);
        if (r.gltfRoot) {
          r.scene!.remove(r.gltfRoot);
          // Release the previous model's GPU memory before replacing it.
          disposeObject3D(r.gltfRoot);
        }
        r.allMeshes = [];
        r.meshMap.clear();
        r.selectedUUID = null;
        clearAllOutlines(r);
        store.clearAll();
        store.setScene(r.scene!);

        r.gltfRoot = gltf.scene;
        r.scene!.add(gltf.scene);
        store.setGltfRoot(gltf.scene);

        const entries: MeshEntry[] = [];
        const snapshots = new Map<string, MaterialSnapshot>();
        gltf.scene.traverse((obj) => {
          if (!(obj as THREE.Mesh).isMesh) return;
          const mesh = obj as THREE.Mesh;
          mesh.castShadow = true;
          mesh.receiveShadow = true;

          // Clone material so each mesh is independent
          if (Array.isArray(mesh.material)) {
            mesh.material = mesh.material.map((m) => m.clone());
          } else if (mesh.material) {
            mesh.material = (mesh.material as THREE.Material).clone();
          }

          r.allMeshes.push(mesh);
          r.meshMap.set(mesh.uuid, mesh);

          const geo = mesh.geometry;
          const vc = geo?.attributes?.position?.count ?? 0;
          const fc = geo?.index ? geo.index.count / 3 : vc / 3;
          const mat = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;

          if (mat) snapshots.set(mesh.uuid, snapshotMaterial(mat));

          entries.push({
            uuid: mesh.uuid,
            name: mesh.name || "(unnamed)",
            mesh,
            visible: mesh.visible,
            vertexCount: vc,
            faceCount: Math.round(fc),
            hasUV: !!geo?.attributes?.uv,
            hasNormals: !!geo?.attributes?.normal,
            hasVertexColor: !!geo?.attributes?.color,
            materialType: mat?.type ?? "—",
          });
        });

        // One store write for every snapshot instead of one write per mesh.
        store.setSnapshots(snapshots);
        store.setMeshEntries(entries);
        store.pushHistoryImmediate(new Map(snapshots));
        frameAll(r);
      },
      undefined,
      (err) => {
        URL.revokeObjectURL(url);
        console.error(err);
        alert("Failed to load GLB file.");
      }
    );
  }, [refs]);

  // ─── Canvas click with multi-select ──────────────────────────────────
  const raycasterRef = useRef(new THREE.Raycaster());
  const mouseRef = useRef(new THREE.Vector2());

  const handleCanvasClick = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const r = refs.current;
    if (!r.renderer || !r.allMeshes.length) return;
    const store = useGLBStore.getState();

    const rect = (e.target as HTMLCanvasElement).getBoundingClientRect();
    mouseRef.current.set(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1
    );
    const cam = store.cameraMode === "ortho" ? r.orthoCamera! : r.perspCamera!;
    const raycaster = raycasterRef.current;
    raycaster.setFromCamera(mouseRef.current, cam);
    const hits = raycaster.intersectObjects(r.allMeshes, false);
    if (!hits.length) return;

    const hit = hits[0].object as THREE.Mesh;
    if (e.ctrlKey || e.metaKey) {
      store.toggleMeshSelection(hit.uuid);
    } else if (e.shiftKey) {
      store.rangeSelectMesh(hit.uuid);
    } else {
      store.selectMesh(hit.uuid);
    }
  }, [refs]);

  return { refs, loadGLB, handleCanvasClick };
}

// ─── Standalone Viewport Helpers ──────────────────────────────────────────

/** Remove a mesh from the scene, the lookup tables and the GPU. */
export function deleteMeshFromViewport(uuid: string, r: ViewportRefs) {
  const mesh = getMesh(r, uuid);
  if (!mesh) return;
  removeOutline(uuid, r);
  if (mesh.parent) mesh.parent.remove(mesh);
  disposeObject3D(mesh);
  r.meshMap.delete(uuid);
  r.allMeshes = r.allMeshes.filter((m) => m !== mesh);
  invalidate();
}

export function frameAll(r: ViewportRefs) {
  if (!r.gltfRoot || !r.perspCamera || !r.controls) return;
  r.gltfRoot.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(r.gltfRoot);
  if (box.isEmpty()) return;

  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z);
  if (maxDim <= 0) return;

  const fov = r.perspCamera.fov * (Math.PI / 180);
  let cameraDistance = Math.abs(maxDim / 2 / Math.tan(fov / 2)) * 1.6;
  cameraDistance = Math.max(cameraDistance, 0.5);

  r.controls.target.copy(center);
  r.perspCamera.position.set(
    center.x + cameraDistance * 0.7,
    center.y + cameraDistance * 0.5,
    center.z + cameraDistance * 0.8
  );

  r.perspCamera.near = Math.max(cameraDistance / 1000, 0.001);
  r.perspCamera.far = Math.min(cameraDistance * 1000, 1000000);
  r.perspCamera.updateProjectionMatrix();

  if (r.orthoCamera) {
    r.orthoCamera.position.copy(r.perspCamera.position);
    r.orthoCamera.quaternion.copy(r.perspCamera.quaternion);
    const aspect = r.perspCamera.aspect;
    const height = maxDim * 1.4;
    r.orthoCamera.left = (-height * aspect) / 2;
    r.orthoCamera.right = (height * aspect) / 2;
    r.orthoCamera.top = height / 2;
    r.orthoCamera.bottom = -height / 2;
    r.orthoCamera.near = r.perspCamera.near;
    r.orthoCamera.far = r.perspCamera.far;
    r.orthoCamera.updateProjectionMatrix();
  }

  r.controls.update();
  invalidate();
}

export function frameSelected(uuid: string, r: ViewportRefs) {
  const mesh = getMesh(r, uuid);
  if (!mesh || !r.perspCamera || !r.controls) return;
  mesh.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(mesh);
  if (box.isEmpty()) return;

  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z);
  if (maxDim <= 0) return;

  const fov = r.perspCamera.fov * (Math.PI / 180);
  let cameraDistance = Math.abs(maxDim / 2 / Math.tan(fov / 2)) * 1.6;
  cameraDistance = Math.max(cameraDistance, 0.5);

  r.controls.target.copy(center);
  r.perspCamera.position.set(
    center.x + cameraDistance * 0.7,
    center.y + cameraDistance * 0.5,
    center.z + cameraDistance * 0.8
  );
  r.perspCamera.updateProjectionMatrix();

  if (r.orthoCamera) {
    r.orthoCamera.position.copy(r.perspCamera.position);
    r.orthoCamera.quaternion.copy(r.perspCamera.quaternion);
    const aspect = r.perspCamera.aspect;
    const height = maxDim * 1.4;
    r.orthoCamera.left = (-height * aspect) / 2;
    r.orthoCamera.right = (height * aspect) / 2;
    r.orthoCamera.top = height / 2;
    r.orthoCamera.bottom = -height / 2;
    r.orthoCamera.updateProjectionMatrix();
  }

  r.controls.update();
  invalidate();
}

/** Snapshot the current material state of the given meshes. */
export function snapshotMeshes(uuids: Iterable<string>, r: ViewportRefs): HistoryStep {
  const step: HistoryStep = new Map();
  for (const uuid of uuids) {
    const mesh = getMesh(r, uuid);
    if (!mesh) continue;
    const mat = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
    if (mat) step.set(uuid, snapshotMaterial(mat as THREE.Material));
  }
  return step;
}

/** Apply a history step (snapshot map) back onto all meshes */
export function applyHistoryStep(step: HistoryStep, r: ViewportRefs) {
  step.forEach((snap, uuid) => {
    const mesh = getMesh(r, uuid);
    if (!mesh) return;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    mats.forEach((m) => applySnapshot(m as THREE.MeshStandardMaterial, snap));
  });
  invalidate();
}
