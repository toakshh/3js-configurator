"use client";

import { useEffect, useRef, useCallback } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { useGLBStore, MeshEntry, HistoryStep } from "@/store/glbStore";
import { snapshotMaterial, applySnapshot } from "@/lib/matUtils";

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
  // uuid → { emissive, emissiveIntensity } — what we saved BEFORE highlight was applied
  highlightMap: Map<string, { emissive: number; emissiveIntensity: number }>;
  selectedUUID: string | null;
}

export function useViewport(canvasRef: React.RefObject<HTMLCanvasElement | null>) {
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
  });
  const animFrameRef = useRef<number>(0);
  const store = useGLBStore();

  // ─── Init Three.js once ───────────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const parent = canvas.parentElement!;

    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
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

    const ambient = new THREE.AmbientLight(0xffffff, 0.4);
    scene.add(ambient);
    const dirLight = new THREE.DirectionalLight(0xffffff, 1.2);
    dirLight.position.set(5, 8, 5);
    dirLight.castShadow = true;
    dirLight.shadow.mapSize.set(2048, 2048);
    scene.add(dirLight);
    const fillLight = new THREE.DirectionalLight(0x8090ff, 0.5);
    fillLight.position.set(-5, 3, -5);
    scene.add(fillLight);

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
    });
    ro.observe(parent);
    renderer.setSize(parent.clientWidth, parent.clientHeight);

    function animate() {
      animFrameRef.current = requestAnimationFrame(animate);
      controls.update();
      const cam = useGLBStore.getState().cameraMode === "ortho" ? orthoCamera : perspCamera;
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

            // ── CRITICAL: clone material so each mesh is independent ──
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

          // Push initial history state so undo has a base
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

// ─── Highlight helpers (operate on the THREE scene directly) ──────────────

export function applyHighlight(mesh: THREE.Mesh, r: ViewportRefs) {
  const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  const first = mats[0] as THREE.MeshStandardMaterial;
  // only save backup if not already highlighted
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
  // clear highlights for deselected meshes
  const toRemove = [...r.highlightMap.keys()].filter((id) => !uuids.has(id));
  toRemove.forEach((id) => clearHighlight(id, r));
  // apply highlights for newly selected meshes
  uuids.forEach((uuid) => {
    if (!r.highlightMap.has(uuid)) {
      const mesh = r.allMeshes.find((m) => m.uuid === uuid);
      if (mesh) applyHighlight(mesh, r);
    }
  });
}

export function frameAll(r: ViewportRefs) {
  if (!r.gltfRoot || !r.perspCamera || !r.controls) return;
  const box = new THREE.Box3().setFromObject(r.gltfRoot);
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3()).length();
  r.controls.target.copy(center);
  r.perspCamera.position.copy(
    center.clone().add(new THREE.Vector3(size * 0.8, size * 0.5, size * 0.8))
  );
  r.controls.update();
}

export function frameSelected(uuid: string, r: ViewportRefs) {
  const mesh = r.allMeshes.find((m) => m.uuid === uuid);
  if (!mesh || !r.perspCamera || !r.controls) return;
  const box = new THREE.Box3().setFromObject(mesh);
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3()).length() || 1;
  r.controls.target.copy(center);
  r.perspCamera.position.copy(
    center.clone().add(new THREE.Vector3(size, size * 0.6, size))
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
