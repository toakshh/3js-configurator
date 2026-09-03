"use client";

import { useEffect, useRef, useCallback } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { Line2 } from "three/examples/jsm/lines/Line2.js";
import { LineGeometry } from "three/examples/jsm/lines/LineGeometry.js";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";
import { useGLBStore, MeshEntry, HistoryStep } from "@/store/glbStore";
import { snapshotMaterial, applySnapshot } from "@/lib/matUtils";

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
  highlightMap: Map<string, { emissive: number; emissiveIntensity: number }>;
  selectedUUID: string | null;

  // Selection outline system (added directly to main scene)
  outlineGroup: THREE.Group;
  outlineLines: Map<string, Line2>;
  outlineMaterial: LineMaterial;
}

// ─── Outline helpers ──────────────────────────────────────────────────────

function createOutlineMaterial(): LineMaterial {
  return new LineMaterial({
    color: 0x7c8bff,
    linewidth: 3, // pixels wide
    dashed: true,
    dashScale: 1,
    dashSize: 6,
    gapSize: 4,
    dashOffset: 0,
    transparent: true,
    opacity: 0.9,
    depthTest: false, // always draw on top of mesh
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

  // Add 1% padding so outline doesn't overlap mesh edges exactly
  const dx = Math.max(size.x * 0.01, 0.002);
  const dy = Math.max(size.y * 0.01, 0.002);
  const dz = Math.max(size.z * 0.01, 0.002);

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

  const geom = new LineGeometry();
  geom.setPositions(vertices);

  const line = new Line2(geom, r.outlineMaterial);
  line.computeLineDistances(); // required for dashed lines
  line.renderOrder = 999;
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
    const mesh = r.allMeshes.find((m) => m.uuid === uuid);
    if (mesh && !r.outlineLines.has(uuid)) {
      addOutline(uuid, mesh, r);
    }
  });
}

function animateOutlines(r: ViewportRefs) {
  if (!r.outlineMaterial) return;
  r.outlineMaterial.dashOffset -= 0.08;
  if (r.outlineMaterial.dashOffset < -10) r.outlineMaterial.dashOffset = 0;
}

// ─── Main Hook ────────────────────────────────────────────────────────────

export function useViewport(canvasRef: React.RefObject<HTMLCanvasElement | null>) {
  const outlineGroupRef = useRef<THREE.Group>(new THREE.Group());

  const refs = useRef<ViewportRefs>({
    renderer: null,
    scene: null,
    perspCamera: null,
    orthoCamera: null,
    controls: null,
    grid: null,
    roomEnvTex: null,
    gltfRoot: null,
    allMeshes: [],
    highlightMap: new Map(),
    selectedUUID: null,

    outlineGroup: outlineGroupRef.current,
    outlineLines: new Map(),
    outlineMaterial: createOutlineMaterial(),
  });
  const animFrameRef = useRef<number>(0);
  const store = useGLBStore();

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
    store.setScene(scene);

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
    });
    ro.observe(parent);
    renderer.setSize(parent.clientWidth, parent.clientHeight);

    function animate() {
      animFrameRef.current = requestAnimationFrame(animate);
      controls.update();
      animateOutlines(refs.current);
      const cam = useGLBStore.getState().cameraMode === "ortho" ? orthoCamera : perspCamera;
      // Single render pass for the whole scene
      renderer.render(scene, cam);
    }
    animate();

    return () => {
      cancelAnimationFrame(animFrameRef.current);
      ro.disconnect();
      renderer.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ─── Sync outlines with selection ──────────────────────────────────────
  useEffect(() => {
    updateOutlines(refs.current);
  }, [store.selectedUUIDs]);

  // ─── Load GLB ─────────────────────────────────────────────────────────
  const loadGLB = useCallback(
    (file: File) => {
      const r = refs.current;
      if (!r.scene) return;

      const url = URL.createObjectURL(file);
      const loader = new GLTFLoader();
      loader.load(
        url,
        (gltf) => {
          URL.revokeObjectURL(url);
          if (r.gltfRoot) r.scene!.remove(r.gltfRoot);
          r.allMeshes = [];
          r.highlightMap.clear();
          r.selectedUUID = null;
          clearAllOutlines(r);
          store.clearAll();
          store.setScene(r.scene!);

          r.gltfRoot = gltf.scene;
          r.scene!.add(gltf.scene);
          store.setGltfRoot(gltf.scene);

          const entries: MeshEntry[] = [];
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

            const geo = mesh.geometry;
            const vc = geo?.attributes?.position?.count ?? 0;
            const fc = geo?.index ? geo.index.count / 3 : vc / 3;
            const mat = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;

            if (mat) {
              store.setSnapshot(mesh.uuid, snapshotMaterial(mat));
            }

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

          store.setMeshEntries(entries);

          const initStep: HistoryStep = new Map();
          entries.forEach((e) => {
            const mat2 = Array.isArray(e.mesh.material) ? e.mesh.material[0] : e.mesh.material;
            if (mat2) initStep.set(e.uuid, snapshotMaterial(mat2 as THREE.Material));
          });
          store.pushHistory(initStep);
          frameAll(r);
        },
        undefined,
        (err) => {
          URL.revokeObjectURL(url);
          console.error(err);
          alert("Failed to load GLB file.");
        }
      );
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [store]
  );

  // ─── Canvas click with multi-select ──────────────────────────────────
  const handleCanvasClick = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const r = refs.current;
      if (!r.renderer || !r.allMeshes.length) return;
      const rect = (e.target as HTMLCanvasElement).getBoundingClientRect();
      const mouse = new THREE.Vector2(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1
      );
      const cam =
        useGLBStore.getState().cameraMode === "ortho"
          ? r.orthoCamera!
          : r.perspCamera!;
      const raycaster = new THREE.Raycaster();
      raycaster.setFromCamera(mouse, cam);
      const hits = raycaster.intersectObjects(r.allMeshes, false);
      if (hits.length) {
        const hit = hits[0].object as THREE.Mesh;
        if (e.ctrlKey || e.metaKey) {
          store.toggleMeshSelection(hit.uuid);
        } else if (e.shiftKey) {
          store.rangeSelectMesh(hit.uuid);
        } else {
          store.selectMesh(hit.uuid);
        }
      }
    },
    [store]
  );

  return { refs, loadGLB, handleCanvasClick };
}

// ─── Standalone Viewport Helpers ──────────────────────────────────────────

export function applyHighlight(mesh: THREE.Mesh, r: ViewportRefs) {
  const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  const first = mats[0] as THREE.MeshStandardMaterial;
  if (!r.highlightMap.has(mesh.uuid)) {
    r.highlightMap.set(mesh.uuid, {
      emissive: first?.emissive?.getHex() ?? 0,
      emissiveIntensity: first?.emissiveIntensity ?? 1,
    });
  }
  mats.forEach((m) => {
    const sm = m as THREE.MeshStandardMaterial;
    if (sm.emissive) {
      sm.emissive.set(0xff6b35);
      sm.emissiveIntensity = 0.3;
    }
  });
}

export function clearHighlight(uuid: string, r: ViewportRefs) {
  const backup = r.highlightMap.get(uuid);
  if (!backup) return;
  const mesh = r.allMeshes.find((m) => m.uuid === uuid);
  if (mesh) {
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    mats.forEach((m) => {
      const sm = m as THREE.MeshStandardMaterial;
      if (sm.emissive) {
        sm.emissive.set(backup.emissive);
        sm.emissiveIntensity = backup.emissiveIntensity;
      }
    });
  }
  r.highlightMap.delete(uuid);
}

export function clearAllHighlights(r: ViewportRefs) {
  const uuids = [...r.highlightMap.keys()];
  uuids.forEach((uuid) => clearHighlight(uuid, r));
}

export function selectMeshByUUID(uuid: string, r: ViewportRefs) {
  clearAllHighlights(r);
  r.selectedUUID = uuid;
  const mesh = r.allMeshes.find((m) => m.uuid === uuid);
  if (mesh) applyHighlight(mesh, r);
}

export function syncHighlightsToSelection(uuids: Set<string>, r: ViewportRefs) {
  const toRemove = [...r.highlightMap.keys()].filter((id) => !uuids.has(id));
  toRemove.forEach((id) => clearHighlight(id, r));
  uuids.forEach((uuid) => {
    if (!r.highlightMap.has(uuid)) {
      const mesh = r.allMeshes.find((m) => m.uuid === uuid);
      if (mesh) applyHighlight(mesh, r);
    }
  });
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
    const aspect = r.perspCamera.aspect;
    r.orthoCamera.left = -maxDim * aspect;
    r.orthoCamera.right = maxDim * aspect;
    r.orthoCamera.top = maxDim;
    r.orthoCamera.bottom = -maxDim;
    r.orthoCamera.position.copy(r.perspCamera.position);
    r.orthoCamera.updateProjectionMatrix();
  }

  r.controls.update();
}

export function frameSelected(uuid: string, r: ViewportRefs) {
  const mesh = r.allMeshes.find((m) => m.uuid === uuid);
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
  r.controls.update();
}

/** Apply a history step (snapshot map) back onto all meshes */
export function applyHistoryStep(step: HistoryStep, r: ViewportRefs) {
  step.forEach((snap, uuid) => {
    const mesh = r.allMeshes.find((m) => m.uuid === uuid);
    if (!mesh) return;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    mats.forEach((m) => applySnapshot(m as THREE.MeshStandardMaterial, snap));
  });
}
