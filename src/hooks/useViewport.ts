"use client";

import { useEffect, useRef, useCallback } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { useGLBStore, MeshEntry } from "@/store/glbStore";
import { snapshotMaterial } from "@/lib/matUtils";

// Per-instance refs shared between Viewport and the hook
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

  // Init three.js once
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

    // Cameras
    const aspect = parent.clientWidth / parent.clientHeight;
    const perspCamera = new THREE.PerspectiveCamera(45, aspect, 0.001, 100000);
    perspCamera.position.set(3, 2, 5);
    refs.current.perspCamera = perspCamera;

    const orthoCamera = new THREE.OrthographicCamera(
      -5 * aspect, 5 * aspect, 5, -5, 0.001, 100000
    );
    orthoCamera.position.set(3, 2, 5);
    refs.current.orthoCamera = orthoCamera;

    // Controls
    const controls = new OrbitControls(perspCamera, canvas);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    refs.current.controls = controls;

    // Environment
    const pmremGen = new THREE.PMREMGenerator(renderer);
    pmremGen.compileEquirectangularShader();
    const roomEnv = new RoomEnvironment();
    const roomEnvTex = pmremGen.fromScene(roomEnv).texture;
    roomEnv.dispose();
    pmremGen.dispose();
    refs.current.roomEnvTex = roomEnvTex;
    scene.environment = roomEnvTex;

    // Grid
    const grid = new THREE.GridHelper(20, 20, 0x334466, 0x222233);
    scene.add(grid);
    refs.current.grid = grid;

    // Lights
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

    // Resize observer
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
    const w = parent.clientWidth;
    const h = parent.clientHeight;
    renderer.setSize(w, h);

    // Animate
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

  // Load GLB
  const loadGLB = useCallback((file: File) => {
    const r = refs.current;
    if (!r.scene) return;

    const url = URL.createObjectURL(file);
    const loader = new GLTFLoader();
    loader.load(
      url,
      (gltf) => {
        URL.revokeObjectURL(url);
        // cleanup old
        if (r.gltfRoot) r.scene!.remove(r.gltfRoot);
        r.allMeshes = [];
        r.highlightMap.clear();
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
          r.allMeshes.push(mesh);

          const geo = mesh.geometry;
          const vc = geo?.attributes?.position?.count ?? 0;
          const fc = geo?.index ? geo.index.count / 3 : vc / 3;
          const mat = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;

          if (mat) {
            const snap = snapshotMaterial(mat);
            store.setSnapshot(mesh.uuid, snap);
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
        frameAll(r);
      },
      undefined,
      (err) => {
        URL.revokeObjectURL(url);
        console.error(err);
        alert("Failed to load GLB file.");
      }
    );
  }, [store]);

  // Raycaster click
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
        selectMeshByUUID(hit.uuid, r);
        store.selectMesh(hit.uuid);
      }
    },
    [store]
  );

  return { refs, loadGLB, handleCanvasClick };
}

// ─── Standalone helpers that operate on refs ───────────────────────────────

export function selectMeshByUUID(uuid: string, r: ViewportRefs) {
  // clear old highlight
  if (r.selectedUUID && r.selectedUUID !== uuid) {
    clearHighlight(r.selectedUUID, r);
  }
  r.selectedUUID = uuid;
  const mesh = r.allMeshes.find((m) => m.uuid === uuid);
  if (mesh) applyHighlight(mesh, r);
}

export function clearHighlight(uuid: string, r: ViewportRefs) {
  const backup = r.highlightMap.get(uuid);
  if (!backup) return;
  const mesh = r.allMeshes.find((m) => m.uuid === uuid);
  if (!mesh) return;
  const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  mats.forEach((m) => {
    const sm = m as THREE.MeshStandardMaterial;
    if (sm.emissive) {
      sm.emissive.set(backup.emissive);
      sm.emissiveIntensity = backup.emissiveIntensity;
    }
  });
  r.highlightMap.delete(uuid);
}

export function applyHighlight(mesh: THREE.Mesh, r: ViewportRefs) {
  const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  const first = mats[0] as THREE.MeshStandardMaterial;
  r.highlightMap.set(mesh.uuid, {
    emissive: first?.emissive?.getHex() ?? 0,
    emissiveIntensity: first?.emissiveIntensity ?? 1,
  });
  mats.forEach((m) => {
    const sm = m as THREE.MeshStandardMaterial;
    if (sm.emissive) {
      sm.emissive.set(0xff6b35);
      sm.emissiveIntensity = 0.25;
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
