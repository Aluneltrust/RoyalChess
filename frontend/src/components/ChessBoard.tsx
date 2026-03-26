// ============================================================================
// CHESS BOARD — Three.js 3D with raycasting
// ============================================================================
import React, { useRef, useEffect, useState, useMemo, forwardRef, useImperativeHandle } from 'react';
import { Chess } from 'chess.js';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

interface ChessBoardProps {
  fen: string;
  myColor: 'white' | 'black';
  isMyTurn: boolean;
  disabled?: boolean;
  isCheck?: boolean;
  lastMove?: { from: string; to: string } | null;
  onMove: (from: string, to: string, promotion?: string) => void;
}

const FILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
const RANKS = ['8', '7', '6', '5', '4', '3', '2', '1'];
const PIECE_UNICODE: Record<string, string> = {
  wK: '♔', wQ: '♕', wR: '♖', wB: '♗', wN: '♘', wP: '♙',
  bK: '♚', bQ: '♛', bR: '♜', bB: '♝', bN: '♞', bP: '♟',
};

// ---- Model loading ----
const MODEL_FILES: Record<string, string> = {
  p: '/models/pawn.glb',
  r: '/models/rook.glb',
  n: '/models/knight.glb',
  b: '/models/bishop.glb',
  q: '/models/queen.glb',
  k: '/models/king.glb',
};

// Target heights for each piece type (in world units)
const PIECE_HEIGHTS: Record<string, number> = {
  p: 0.63, r: 0.75, n: 0.81, b: 0.92, q: 1.04, k: 1.09,
};

// Cache loaded & normalized geometries
const MODEL_CACHE: Record<string, THREE.BufferGeometry> = {};
let modelsLoaded = false;
let modelLoadPromise: Promise<void> | null = null;

function loadAllModels(): Promise<void> {
  if (modelLoadPromise) return modelLoadPromise;
  const loader = new GLTFLoader();

  modelLoadPromise = Promise.all(
    Object.entries(MODEL_FILES).map(([type, url]) =>
      new Promise<void>((resolve) => {
        loader.load(url, (gltf) => {
          console.log(`[3D] Loaded model: ${type} from ${url}`);
          // Find the first mesh in the scene
          let geo: THREE.BufferGeometry | null = null;
          gltf.scene.traverse((child) => {
            if (!geo && (child as THREE.Mesh).isMesh) {
              geo = (child as THREE.Mesh).geometry.clone();
            }
          });

          if (geo) {
            const g: THREE.BufferGeometry = geo;

            // Debug: check raw dimensions before any rotation
            g.computeBoundingBox();
            const rawBox = g.boundingBox!;
            const rawW = rawBox.max.x - rawBox.min.x;
            const rawH = rawBox.max.y - rawBox.min.y;
            const rawD = rawBox.max.z - rawBox.min.z;
            console.log(`[3D] ${type} RAW: x=${rawW.toFixed(4)} y=${rawH.toFixed(4)} z=${rawD.toFixed(4)}`);

            // The tallest axis is the piece height — we need it to be Y
            // Find which axis is tallest
            const dims = [
              { axis: 'x', val: rawW },
              { axis: 'y', val: rawH },
              { axis: 'z', val: rawD },
            ].sort((a, b) => b.val - a.val);
            const tallAxis = dims[0].axis;
            console.log(`[3D] ${type} tallest axis: ${tallAxis} (${dims[0].val.toFixed(4)})`);

            // Rotate so tallest axis becomes Y (up)
            if (tallAxis === 'z') {
              g.applyMatrix4(new THREE.Matrix4().makeRotationX(-Math.PI / 2));
            } else if (tallAxis === 'x') {
              g.applyMatrix4(new THREE.Matrix4().makeRotationZ(Math.PI / 2));
            }

            // Check if piece is upside down (base should be at min Y)
            // The raw data has negative Y values (min=-0.169, max=0) meaning piece hangs downward
            // Negate Y positions and flip normals properly
            const posAttr = g.getAttribute('position');
            for (let i = 0; i < posAttr.count; i++) {
              posAttr.setY(i, -posAttr.getY(i));
            }
            posAttr.needsUpdate = true;
            // Flip normals to match
            const normAttr = g.getAttribute('normal');
            if (normAttr) {
              for (let i = 0; i < normAttr.count; i++) {
                normAttr.setY(i, -normAttr.getY(i));
              }
              normAttr.needsUpdate = true;
            }
            // Reverse face winding
            const idx = g.getIndex();
            if (idx) {
              const arr = idx.array as Uint16Array | Uint32Array;
              for (let i = 0; i < arr.length; i += 3) {
                const tmp = arr[i + 1];
                arr[i + 1] = arr[i + 2];
                arr[i + 2] = tmp;
              }
              idx.needsUpdate = true;
            }

            // Center horizontally, sit on Y=0
            g.computeBoundingBox();
            const box = g.boundingBox!;
            const cx = (box.min.x + box.max.x) / 2;
            const cz = (box.min.z + box.max.z) / 2;
            const bottomY = box.min.y;
            g.translate(-cx, -bottomY, -cz);

            // Scale to target height
            g.computeBoundingBox();
            const currentH = g.boundingBox!.max.y - g.boundingBox!.min.y;
            const targetH = PIECE_HEIGHTS[type];
            if (currentH > 0) {
              const s = targetH / currentH;
              g.scale(s, s, s);
            }

            g.computeBoundingBox();
            const finalBox = g.boundingBox!;
            console.log(`[3D] ${type}: final size w=${(finalBox.max.x-finalBox.min.x).toFixed(3)} h=${(finalBox.max.y-finalBox.min.y).toFixed(3)} d=${(finalBox.max.z-finalBox.min.z).toFixed(3)}`);
            MODEL_CACHE[type] = g;
          }
          resolve();
        }, undefined, (err) => { console.error(`[3D] Failed to load ${type}:`, err); resolve(); }); // resolve even on error — fallback to lathe
      })
    )
  ).then(() => { modelsLoaded = true; });

  return modelLoadPromise;
}

// Fallback lathe geometries if models fail to load
function lathe(raw: number[][]): THREE.LatheGeometry {
  return new THREE.LatheGeometry(raw.map(([x, y]) => new THREE.Vector2(x, y)), 16);
}
const FALLBACK_GEO: Record<string, () => THREE.LatheGeometry> = {
  p: () => lathe([[0,0],[.35,0],[.35,.05],[.25,.1],[.18,.35],[.22,.4],[.22,.45],[.18,.5],[.2,.6],[.2,.65],[.15,.72],[.08,.8],[0,.85]]),
  r: () => lathe([[0,0],[.38,0],[.38,.06],[.28,.1],[.22,.15],[.2,.6],[.25,.65],[.3,.68],[.3,.75],[.32,.78],[.32,.95],[.22,.95],[.22,.85],[.15,.85],[.15,.95],[0,.95]]),
  n: () => lathe([[0,0],[.38,0],[.38,.06],[.28,.1],[.2,.2],[.18,.45],[.22,.5],[.24,.6],[.2,.75],[.15,.85],[.1,.92],[.05,.96],[0,1]]),
  b: () => lathe([[0,0],[.36,0],[.36,.05],[.26,.1],[.18,.2],[.16,.5],[.2,.55],[.2,.6],[.15,.68],[.12,.8],[.08,.92],[.05,.98],[.04,1.02],[.06,1.06],[.03,1.1],[0,1.12]]),
  q: () => lathe([[0,0],[.38,0],[.38,.06],[.28,.1],[.2,.2],[.17,.5],[.2,.55],[.22,.6],[.25,.7],[.22,.8],[.16,.9],[.12,1],[.08,1.1],[.1,1.15],[.06,1.2],[.08,1.25],[.04,1.3],[0,1.32]]),
  k: () => lathe([[0,0],[.4,0],[.4,.06],[.3,.1],[.22,.2],[.18,.55],[.22,.6],[.24,.65],[.2,.75],[.16,.9],[.14,1],[.1,1.1],[.12,1.15],[.08,1.22],[.1,1.28],[.04,1.35],[.04,1.42],[0,1.45]]),
};
const FALLBACK_CACHE: Record<string, THREE.LatheGeometry> = {};

function getGeo(type: string): THREE.BufferGeometry {
  if (MODEL_CACHE[type]) return MODEL_CACHE[type];
  return FALLBACK_CACHE[type] || (FALLBACK_CACHE[type] = FALLBACK_GEO[type]());
}

function sq2world(f: string, r: string): [number, number] {
  const col = FILES.indexOf(f), row = 7 - RANKS.indexOf(r);
  return [col - 3.5, row - 3.5];
}

// ============================================================================

interface Particle {
  mesh: THREE.Sprite;
  vx: number; vy: number; vz: number;
  life: number; maxLife: number;
  startScale: number;
}

interface ThreeState {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  raycaster: THREE.Raycaster;
  mouse: THREE.Vector2;
  squares: Map<string, THREE.Mesh>;
  pieces: Map<string, THREE.Mesh>;
  dots: THREE.Mesh[];
  particles: Particle[];
  frameId: number;
  cleanups: (() => void)[];
}

export interface ChessBoardHandle {
  resetView: () => void;
  topView: () => void;
}

const ChessBoard = forwardRef<ChessBoardHandle, ChessBoardProps>(function ChessBoard({
  fen, myColor, isMyTurn, disabled, isCheck, lastMove, onMove,
}, ref) {
  const containerRef = useRef<HTMLDivElement>(null);
  const threeRef = useRef<ThreeState | null>(null);

  const [selected, setSelected] = useState<string | null>(null);
  const [promotion, setPromotion] = useState<{ from: string; to: string } | null>(null);
  const [modelsReady, setModelsReady] = useState(modelsLoaded);

  useImperativeHandle(ref, () => ({
    resetView: () => { const el = containerRef.current; if (el) (el as any).__resetView?.(); },
    topView: () => { const el = containerRef.current; if (el) (el as any).__topView?.(); },
  }));

  const chess = useMemo(() => new Chess(fen), [fen]);

  const legalMoves = useMemo(() => {
    if (!selected || !isMyTurn || disabled) return new Set<string>();
    return new Set(chess.moves({ square: selected as any, verbose: true }).map(m => m.to));
  }, [selected, fen, isMyTurn, disabled]);

  const kingInCheck = useMemo(() => {
    if (!isCheck) return null;
    const b = chess.board(), t = chess.turn();
    for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
      const p = b[r][c];
      if (p && p.type === 'k' && p.color === t) return FILES[c] + RANKS[r];
    }
    return null;
  }, [fen, isCheck]);

  // Latest state ref for click handler
  const stateRef = useRef({ selected, legalMoves, chess, isMyTurn, disabled, myColor, onMove, setSelected, setPromotion });
  stateRef.current = { selected, legalMoves, chess, isMyTurn, disabled, myColor, onMove, setSelected, setPromotion };

  // ==== INIT THREE.JS SCENE (once per myColor) ====
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    // Force a size if element has no intrinsic size yet
    const w = el.clientWidth || 500;
    const h = el.clientHeight || 500;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0f1117);

    const camera = new THREE.PerspectiveCamera(40, w / h, 0.1, 50);
    const initAngle = myColor === 'white' ? Math.PI : 0;

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(w, h);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.3;
    el.appendChild(renderer.domElement);

    // Lighting
    scene.add(new THREE.AmbientLight(0x8090b0, 0.5));
    const keyL = new THREE.DirectionalLight(0xfff0d0, 1.6);
    keyL.position.set(6, 12, 4);
    keyL.castShadow = true;
    keyL.shadow.mapSize.set(2048, 2048);
    keyL.shadow.camera.near = 1; keyL.shadow.camera.far = 30;
    keyL.shadow.camera.left = -6; keyL.shadow.camera.right = 6;
    keyL.shadow.camera.top = 6; keyL.shadow.camera.bottom = -6;
    keyL.shadow.bias = -0.001; keyL.shadow.radius = 3;
    scene.add(keyL);
    const fillL = new THREE.DirectionalLight(0x6080c0, 0.5);
    fillL.position.set(-6, 6, -3);
    scene.add(fillL);
    const rimL = new THREE.DirectionalLight(0xc0d0ff, 0.4);
    rimL.position.set(-2, 5, -8);
    scene.add(rimL);
    scene.add(new THREE.HemisphereLight(0x606880, 0x1a1410, 0.4));
    const glowL = new THREE.PointLight(0xffe8c0, 0.3, 10);
    glowL.position.set(0, 3, 0);
    scene.add(glowL);

    // ---- Procedural wood texture generator ----
    function makeWoodTex(baseR: number, baseG: number, baseB: number, grainDark: number, size = 512): THREE.CanvasTexture {
      const canvas = document.createElement('canvas');
      canvas.width = size; canvas.height = size;
      const ctx = canvas.getContext('2d')!;

      // Base fill
      ctx.fillStyle = `rgb(${baseR},${baseG},${baseB})`;
      ctx.fillRect(0, 0, size, size);

      // Wood grain lines
      for (let i = 0; i < 80; i++) {
        const y = Math.random() * size;
        const thickness = 0.5 + Math.random() * 2.5;
        const wave = 2 + Math.random() * 6;
        const alpha = 0.04 + Math.random() * 0.12;
        ctx.beginPath();
        ctx.strokeStyle = `rgba(${grainDark},${grainDark},${Math.floor(grainDark * 0.6)},${alpha})`;
        ctx.lineWidth = thickness;
        for (let x = 0; x < size; x += 2) {
          const yOff = Math.sin((x + i * 40) / (30 + wave * 10)) * wave + Math.sin((x + i * 17) / 60) * 3;
          if (x === 0) ctx.moveTo(x, y + yOff);
          else ctx.lineTo(x, y + yOff);
        }
        ctx.stroke();
      }

      // Subtle knots
      for (let k = 0; k < 3; k++) {
        const kx = 60 + Math.random() * (size - 120);
        const ky = 60 + Math.random() * (size - 120);
        const kr = 8 + Math.random() * 18;
        const grad = ctx.createRadialGradient(kx, ky, 0, kx, ky, kr);
        grad.addColorStop(0, `rgba(${Math.floor(grainDark * 0.7)},${Math.floor(grainDark * 0.5)},${Math.floor(grainDark * 0.3)},0.2)`);
        grad.addColorStop(0.5, `rgba(${grainDark},${Math.floor(grainDark * 0.8)},${Math.floor(grainDark * 0.5)},0.08)`);
        grad.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.ellipse(kx, ky, kr, kr * 0.6, Math.random() * Math.PI, 0, Math.PI * 2);
        ctx.fill();

        // Rings around knot
        for (let ring = 0; ring < 5; ring++) {
          ctx.beginPath();
          ctx.strokeStyle = `rgba(${grainDark},${Math.floor(grainDark * 0.7)},${Math.floor(grainDark * 0.4)},0.06)`;
          ctx.lineWidth = 0.5;
          ctx.ellipse(kx, ky, kr + ring * 6, (kr + ring * 6) * 0.5, Math.random() * 0.3, 0, Math.PI * 2);
          ctx.stroke();
        }
      }

      // Fine noise for pores
      const imgData = ctx.getImageData(0, 0, size, size);
      for (let p = 0; p < imgData.data.length; p += 4) {
        const noise = (Math.random() - 0.5) * 10;
        imgData.data[p] = Math.max(0, Math.min(255, imgData.data[p] + noise));
        imgData.data[p + 1] = Math.max(0, Math.min(255, imgData.data[p + 1] + noise));
        imgData.data[p + 2] = Math.max(0, Math.min(255, imgData.data[p + 2] + noise));
      }
      ctx.putImageData(imgData, 0, 0);

      const tex = new THREE.CanvasTexture(canvas);
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
      tex.repeat.set(1, 1);
      return tex;
    }

    // Generate textures: light maple, dark walnut, frame mahogany
    const lightWoodTex = makeWoodTex(232, 213, 170, 140);   // light maple
    const darkWoodTex = makeWoodTex(140, 100, 60, 60);       // dark walnut
    const frameTex = makeWoodTex(58, 37, 16, 30);            // dark mahogany

    // Frame
    const frame = new THREE.Mesh(
      new THREE.BoxGeometry(9.2, 0.25, 9.2),
      new THREE.MeshStandardMaterial({ map: frameTex, roughness: 0.5, metalness: 0.08 })
    );
    frame.position.y = -0.13; frame.receiveShadow = true; scene.add(frame);

    // Squares
    const sqGeo = new THREE.BoxGeometry(0.98, 0.08, 0.98);
    const lMat = new THREE.MeshStandardMaterial({ map: lightWoodTex, roughness: 0.4, metalness: 0.01 });
    const dMat = new THREE.MeshStandardMaterial({ map: darkWoodTex, roughness: 0.35, metalness: 0.02 });
    const squares = new Map<string, THREE.Mesh>();
    for (const f of FILES) for (const r of RANKS) {
      const isL = (FILES.indexOf(f) + RANKS.indexOf(r)) % 2 === 0;
      const mat = (isL ? lMat : dMat).clone();
      // Vary texture offset per square so grain looks unique
      if (mat.map) {
        mat.map = mat.map.clone();
        mat.map.offset.set(Math.random(), Math.random());
        mat.map.rotation = Math.random() * Math.PI * 0.5;
        mat.map.needsUpdate = true;
      }
      const m = new THREE.Mesh(sqGeo, mat);
      const [x, z] = sq2world(f, r);
      m.position.set(x, 0, z); m.receiveShadow = true; m.userData.square = f + r;
      scene.add(m); squares.set(f + r, m);
    }

    // Shadow ground
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(20, 20), new THREE.ShadowMaterial({ opacity: 0.3 }));
    ground.rotation.x = -Math.PI / 2; ground.position.y = -0.25; ground.receiveShadow = true; scene.add(ground);

    // ========================================================================
    // AMBIENT PARTICLE SYSTEMS — fire embers, smoke, floating sparks
    // ========================================================================

    // --- Shared texture generators ---
    function makeGlowTex(r: number, g: number, b: number, size = 64): THREE.CanvasTexture {
      const c = document.createElement('canvas'); c.width = size; c.height = size;
      const ctx = c.getContext('2d')!;
      const grad = ctx.createRadialGradient(size/2, size/2, 0, size/2, size/2, size/2);
      grad.addColorStop(0, `rgba(${r},${g},${b},1)`);
      grad.addColorStop(0.3, `rgba(${r},${g},${b},0.6)`);
      grad.addColorStop(0.7, `rgba(${r},${g},${b},0.15)`);
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = grad; ctx.fillRect(0, 0, size, size);
      const tex = new THREE.CanvasTexture(c);
      tex.needsUpdate = true;
      return tex;
    }

    const emberTex = makeGlowTex(255, 120, 20);    // orange-red ember
    const fireTex = makeGlowTex(255, 60, 10);      // deep red fire
    const smokeTex = makeGlowTex(100, 100, 110);   // gray smoke
    const sparkTex = makeGlowTex(255, 220, 100);   // golden spark
    const magicTex = makeGlowTex(80, 160, 255);    // blue magic

    // --- Ember particles (rising from edges of the board) ---
    interface AmbientParticle {
      sprite: THREE.Sprite;
      vx: number; vy: number; vz: number;
      life: number; maxLife: number;
      startScale: number;
      type: 'ember' | 'smoke' | 'spark' | 'magic';
    }
    const ambientParticles: AmbientParticle[] = [];
    const MAX_AMBIENT = 120;

    function spawnEmber() {
      const side = Math.floor(Math.random() * 4);
      let x = 0, z = 0;
      const boardEdge = 4.6;
      switch (side) {
        case 0: x = -boardEdge + Math.random() * boardEdge * 2; z = -boardEdge - Math.random() * 0.5; break;
        case 1: x = -boardEdge + Math.random() * boardEdge * 2; z = boardEdge + Math.random() * 0.5; break;
        case 2: x = -boardEdge - Math.random() * 0.5; z = -boardEdge + Math.random() * boardEdge * 2; break;
        case 3: x = boardEdge + Math.random() * 0.5; z = -boardEdge + Math.random() * boardEdge * 2; break;
      }
      const tex = Math.random() < 0.6 ? emberTex : fireTex;
      const mat = new THREE.SpriteMaterial({ map: tex, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, opacity: 0 });
      const sprite = new THREE.Sprite(mat);
      const scale = 0.08 + Math.random() * 0.15;
      sprite.scale.set(scale, scale, scale);
      sprite.position.set(x, -0.3 + Math.random() * 0.2, z);
      scene.add(sprite);
      ambientParticles.push({
        sprite, type: 'ember',
        vx: (Math.random() - 0.5) * 0.003,
        vy: 0.008 + Math.random() * 0.015,
        vz: (Math.random() - 0.5) * 0.003,
        life: 1.5 + Math.random() * 2.5,
        maxLife: 1.5 + Math.random() * 2.5,
        startScale: scale,
      });
    }

    // --- Smoke wisps (slow rising from under board) ---
    function spawnSmoke() {
      const x = -3.5 + Math.random() * 7;
      const z = -3.5 + Math.random() * 7;
      const mat = new THREE.SpriteMaterial({ map: smokeTex, blending: THREE.NormalBlending, transparent: true, depthWrite: false, opacity: 0 });
      const sprite = new THREE.Sprite(mat);
      const scale = 0.4 + Math.random() * 0.8;
      sprite.scale.set(scale, scale, scale);
      sprite.position.set(x, -0.4, z);
      scene.add(sprite);
      ambientParticles.push({
        sprite, type: 'smoke',
        vx: (Math.random() - 0.5) * 0.001,
        vy: 0.003 + Math.random() * 0.005,
        vz: (Math.random() - 0.5) * 0.001,
        life: 3 + Math.random() * 4,
        maxLife: 3 + Math.random() * 4,
        startScale: scale,
      });
    }

    // --- Floating sparks (golden, orbiting around board) ---
    function spawnSpark() {
      const angle = Math.random() * Math.PI * 2;
      const radius = 4 + Math.random() * 2;
      const x = Math.cos(angle) * radius;
      const z = Math.sin(angle) * radius;
      const y = 0.5 + Math.random() * 3;
      const tex = Math.random() < 0.7 ? sparkTex : magicTex;
      const mat = new THREE.SpriteMaterial({ map: tex, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, opacity: 0 });
      const sprite = new THREE.Sprite(mat);
      const scale = 0.03 + Math.random() * 0.06;
      sprite.scale.set(scale, scale, scale);
      sprite.position.set(x, y, z);
      scene.add(sprite);
      const orbitSpeed = (Math.random() - 0.5) * 0.008;
      ambientParticles.push({
        sprite, type: 'spark',
        vx: orbitSpeed,  // reuse as orbit speed
        vy: (Math.random() - 0.5) * 0.002,
        vz: radius,       // reuse as orbit radius
        life: 3 + Math.random() * 5,
        maxLife: 3 + Math.random() * 5,
        startScale: scale,
      });
    }

    // --- Under-board glow (warm light that pulses) ---
    const underGlow = new THREE.PointLight(0xff6820, 0.4, 12);
    underGlow.position.set(0, -0.5, 0);
    scene.add(underGlow);

    const underGlow2 = new THREE.PointLight(0xff4010, 0.3, 8);
    underGlow2.position.set(2, -0.3, -2);
    scene.add(underGlow2);

    const underGlow3 = new THREE.PointLight(0xff8030, 0.2, 8);
    underGlow3.position.set(-2, -0.3, 2);
    scene.add(underGlow3);

    // Ambient spawn timers
    let ambientTime = 0;

    const raycaster = new THREE.Raycaster();
    const mouse = new THREE.Vector2();
    const cleanups: (() => void)[] = [];

    const T: ThreeState = { scene, camera, renderer, raycaster, mouse, squares, pieces: new Map(), dots: [], particles: [], frameId: 0, cleanups };
    threeRef.current = T;

    // Camera orbit — zoom out more on mobile
    const isMobile = window.innerWidth < 600;
    const DEFAULT_ANGLE = initAngle, DEFAULT_PITCH = 0.65, DEFAULT_DIST = isMobile ? 30 : 18;
    const TOP_PITCH = 1.5, TOP_DIST = isMobile ? 24 : 14;
    let angle = DEFAULT_ANGLE, pitch = DEFAULT_PITCH, dist = DEFAULT_DIST;
    let orbiting = false, ox = 0, oy = 0, downX = 0, downY = 0;
    let animating = false;

    function setCam() {
      camera.position.set(
        Math.sin(angle) * Math.cos(pitch) * dist,
        Math.sin(pitch) * dist,
        Math.cos(angle) * Math.cos(pitch) * dist
      );
      camera.lookAt(0, 0, 0);
    }
    setCam();

    // Smooth camera transition
    function animateCam(targetAngle: number, targetPitch: number, targetDist: number) {
      if (animating) return;
      animating = true;
      const startAngle = angle, startPitch = pitch, startDist = dist;
      const duration = 400;
      const startTime = performance.now();
      function step(now: number) {
        const t = Math.min(1, (now - startTime) / duration);
        const ease = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; // easeInOutQuad
        angle = startAngle + (targetAngle - startAngle) * ease;
        pitch = startPitch + (targetPitch - startPitch) * ease;
        dist = startDist + (targetDist - startDist) * ease;
        setCam();
        if (t < 1) requestAnimationFrame(step);
        else animating = false;
      }
      requestAnimationFrame(step);
    }

    // Expose camera controls
    (el as any).__resetView = () => animateCam(DEFAULT_ANGLE, DEFAULT_PITCH, DEFAULT_DIST);
    (el as any).__topView = () => animateCam(angle, TOP_PITCH, TOP_DIST);

    function doClick(cx: number, cy: number) {
      const S = stateRef.current;
      console.log('[3D] doClick — isMyTurn:', S.isMyTurn, 'disabled:', S.disabled);
      if (S.disabled || !S.isMyTurn) return;
      const rect = renderer.domElement.getBoundingClientRect();
      mouse.x = ((cx - rect.left) / rect.width) * 2 - 1;
      mouse.y = -((cy - rect.top) / rect.height) * 2 + 1;
      console.log('[3D] mouse:', mouse.x.toFixed(3), mouse.y.toFixed(3));
      raycaster.setFromCamera(mouse, camera);
      const targets = [...T.squares.values(), ...T.pieces.values(), ...T.dots];
      const hits = raycaster.intersectObjects(targets);
      console.log('[3D] hits:', hits.length, 'targets:', targets.length);
      let sq: string | null = null;
      for (const h of hits) { if (h.object.userData.square) { sq = h.object.userData.square; break; } }
      console.log('[3D] square:', sq);
      if (!sq) { S.setSelected(null); return; }
      const piece = S.chess.get(sq as any);
      const myC = S.myColor === 'white' ? 'w' : 'b';
      console.log('[3D] piece:', piece?.type, piece?.color, 'myC:', myC, 'selected:', S.selected);
      if (S.selected) {
        if (S.selected === sq) { S.setSelected(null); return; }
        if (S.legalMoves.has(sq)) {
          const mp = S.chess.get(S.selected as any);
          if (mp?.type === 'p' && (sq[1] === '8' || sq[1] === '1')) { S.setPromotion({ from: S.selected, to: sq }); return; }
          S.onMove(S.selected, sq); S.setSelected(null); return;
        }
        if (piece && piece.color === myC) { S.setSelected(sq); return; }
        S.setSelected(null); return;
      }
      if (piece && piece.color === myC) S.setSelected(sq);
    }

    // Events on canvas
    const cvs = renderer.domElement;
    const onDown = (e: PointerEvent) => {
      downX = e.clientX; downY = e.clientY;
      if (e.button === 2 || e.button === 1) { orbiting = true; ox = e.clientX; oy = e.clientY; e.preventDefault(); }
    };
    const onMoveEvt = (e: PointerEvent) => {
      if (!orbiting) return;
      angle -= (e.clientX - ox) * 0.005;
      pitch = Math.max(0.2, Math.min(1.4, pitch + (e.clientY - oy) * 0.005));
      ox = e.clientX; oy = e.clientY; setCam();
    };
    const onUp = () => { orbiting = false; };
    const onClick = (e: MouseEvent) => {
      if (Math.abs(e.clientX - downX) < 5 && Math.abs(e.clientY - downY) < 5) {
        doClick(e.clientX, e.clientY);
      }
    };
    const onWheel = (e: WheelEvent) => { dist = Math.max(6, Math.min(18, dist + e.deltaY * 0.01)); setCam(); e.preventDefault(); };
    const onCtx = (e: Event) => e.preventDefault();
    const onResize = () => {
      const nw = el.clientWidth, nh = el.clientHeight;
      if (nw > 0 && nh > 0) { camera.aspect = nw / nh; camera.updateProjectionMatrix(); renderer.setSize(nw, nh); }
    };

    cvs.addEventListener('pointerdown', onDown);
    cvs.addEventListener('click', onClick);
    window.addEventListener('pointermove', onMoveEvt);
    window.addEventListener('pointerup', onUp);
    cvs.addEventListener('wheel', onWheel, { passive: false });
    cvs.addEventListener('contextmenu', onCtx);
    window.addEventListener('resize', onResize);

    // Render loop
    function animate() {
      T.frameId = requestAnimationFrame(animate);
      const dt = 0.016; // ~60fps
      ambientTime += dt;

      // --- Spawn ambient particles ---
      if (ambientParticles.length < MAX_AMBIENT) {
        if (Math.random() < 0.15) spawnEmber();
        if (Math.random() < 0.03) spawnSmoke();
        if (Math.random() < 0.05) spawnSpark();
      }

      // --- Pulse under-board glow ---
      underGlow.intensity = 0.35 + Math.sin(ambientTime * 1.5) * 0.15;
      underGlow2.intensity = 0.25 + Math.sin(ambientTime * 2.1 + 1) * 0.12;
      underGlow3.intensity = 0.2 + Math.sin(ambientTime * 1.8 + 2.5) * 0.1;

      // --- Update ambient particles ---
      for (let i = ambientParticles.length - 1; i >= 0; i--) {
        const p = ambientParticles[i];
        p.life -= dt;
        if (p.life <= 0) {
          scene.remove(p.sprite);
          (p.sprite.material as THREE.SpriteMaterial).dispose();
          ambientParticles.splice(i, 1);
          continue;
        }
        const t = 1 - p.life / p.maxLife; // 0 → 1

        if (p.type === 'ember') {
          p.sprite.position.x += p.vx + Math.sin(ambientTime * 3 + i) * 0.001;
          p.sprite.position.y += p.vy;
          p.sprite.position.z += p.vz;
          p.vy *= 0.999; // slight deceleration
          // Flicker
          const flicker = 0.7 + Math.sin(ambientTime * 12 + i * 7) * 0.3;
          const fadeIn = Math.min(1, t * 5);
          const fadeOut = Math.max(0, 1 - (t - 0.6) / 0.4);
          (p.sprite.material as THREE.SpriteMaterial).opacity = fadeIn * fadeOut * flicker;
          const s = p.startScale * (1 - t * 0.3);
          p.sprite.scale.set(s, s, s);
        }

        else if (p.type === 'smoke') {
          p.sprite.position.x += p.vx + Math.sin(ambientTime * 0.5 + i * 3) * 0.002;
          p.sprite.position.y += p.vy;
          p.sprite.position.z += p.vz;
          // Slow expand
          const s = p.startScale * (1 + t * 1.5);
          p.sprite.scale.set(s, s, s);
          const fadeIn = Math.min(1, t * 3);
          const fadeOut = Math.max(0, 1 - (t - 0.5) / 0.5);
          (p.sprite.material as THREE.SpriteMaterial).opacity = fadeIn * fadeOut * 0.12;
        }

        else if (p.type === 'spark') {
          // Orbit around board
          const orbitSpeed = p.vx;
          const radius = p.vz;
          const currentAngle = Math.atan2(p.sprite.position.x, p.sprite.position.z) + orbitSpeed;
          p.sprite.position.x = Math.sin(currentAngle) * radius;
          p.sprite.position.z = Math.cos(currentAngle) * radius;
          p.sprite.position.y += p.vy + Math.sin(ambientTime * 2 + i) * 0.001;
          // Twinkle
          const twinkle = 0.4 + Math.sin(ambientTime * 8 + i * 11) * 0.6;
          const fadeIn = Math.min(1, t * 4);
          const fadeOut = Math.max(0, 1 - (t - 0.7) / 0.3);
          (p.sprite.material as THREE.SpriteMaterial).opacity = fadeIn * fadeOut * twinkle;
          const s = p.startScale * (0.8 + Math.sin(ambientTime * 6 + i * 5) * 0.3);
          p.sprite.scale.set(s, s, s);
        }
      }

      // Update existing fire/capture particles
      for (let i = T.particles.length - 1; i >= 0; i--) {
        const p = T.particles[i];
        p.life -= 0.016;
        if (p.life <= 0) {
          scene.remove(p.mesh);
          p.mesh.material.dispose();
          T.particles.splice(i, 1);
          continue;
        }
        const t = 1 - p.life / p.maxLife;
        p.mesh.position.x += p.vx;
        p.mesh.position.y += p.vy;
        p.mesh.position.z += p.vz;
        p.vy += 0.001;
        const scale = p.startScale * (1 - t * 0.5);
        p.mesh.scale.set(scale, scale, scale);
        (p.mesh.material as THREE.SpriteMaterial).opacity = 1 - t;
      }

      renderer.render(scene, camera);
    }
    animate();

    // Delayed resize in case container size changed after mount
    requestAnimationFrame(() => onResize());

    // Load 3D models
    if (!modelsLoaded) {
      loadAllModels().then(() => setModelsReady(true));
    }

    return () => {
      cancelAnimationFrame(T.frameId);
      T.cleanups.forEach(fn => fn());
      cvs.removeEventListener('pointerdown', onDown);
      cvs.removeEventListener('click', onClick);
      window.removeEventListener('pointermove', onMoveEvt);
      window.removeEventListener('pointerup', onUp);
      cvs.removeEventListener('wheel', onWheel);
      cvs.removeEventListener('contextmenu', onCtx);
      window.removeEventListener('resize', onResize);
      renderer.dispose();
      if (el.contains(cvs)) el.removeChild(cvs);
      threeRef.current = null;
    };
  }, [myColor]);

  // ==== UPDATE PIECES (runs on every fen change) ====
  useEffect(() => {
    if (!threeRef.current) return;
    const T: ThreeState = threeRef.current;

    // Remove old pieces
    T.pieces.forEach(m => { T.scene.remove(m); if (m.geometry) m.geometry.dispose(); });
    T.pieces.clear();

    // Add new pieces
    const wMat = new THREE.MeshStandardMaterial({ color: 0xf5e6cc, roughness: 0.25, metalness: 0.02 });
    const bMat = new THREE.MeshStandardMaterial({ color: 0x1e1a16, roughness: 0.2, metalness: 0.08 });
    const board = chess.board();
    for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
      const p = board[r][c];
      if (!p) continue;
      const mesh = new THREE.Mesh(getGeo(p.type), (p.color === 'w' ? wMat : bMat).clone());
      const [x, z] = sq2world(FILES[c], RANKS[r]);
      mesh.position.set(x, 0.04, z);

      // Knight: face forward (toward opponent)
      if (p.type === 'n' && MODEL_CACHE['n']) {
        mesh.rotation.y = p.color === 'w' ? 0 : Math.PI;
      }

      mesh.castShadow = true; mesh.receiveShadow = true;
      mesh.userData.square = FILES[c] + RANKS[r];
      T.scene.add(mesh);
      T.pieces.set(FILES[c] + RANKS[r], mesh);
    }
  }, [fen, myColor, chess, modelsReady]);

  // ==== UPDATE HIGHLIGHTS (fire/smoke) ====
  useEffect(() => {
    if (!threeRef.current) return;
    const T: ThreeState = threeRef.current;

    // Helper: radial gradient particle texture
    function makeParticleTex(r1: number, g1: number, b1: number): THREE.Texture {
      const c = document.createElement('canvas');
      c.width = 64; c.height = 64;
      const ctx = c.getContext('2d')!;
      const gr = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
      gr.addColorStop(0, `rgba(${r1},${g1},${b1},1)`);
      gr.addColorStop(0.4, `rgba(${r1},${g1},${b1},0.5)`);
      gr.addColorStop(1, `rgba(${r1},${g1},${b1},0)`);
      ctx.fillStyle = gr; ctx.fillRect(0, 0, 64, 64);
      return new THREE.CanvasTexture(c);
    }

    function spawnFire(x: number, z: number, count: number, rgb: [number,number,number], scale: number, life: number) {
      const tex = makeParticleTex(...rgb);
      for (let i = 0; i < count; i++) {
        const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
        const sp = new THREE.Sprite(mat);
        sp.position.set(x + (Math.random()-.5)*0.3, 0.08 + Math.random()*0.1, z + (Math.random()-.5)*0.3);
        const s = scale * (0.6 + Math.random()*0.8);
        sp.scale.set(s, s, s);
        T.scene.add(sp);
        T.particles.push({ mesh: sp, vx: (Math.random()-.5)*0.003, vy: 0.005+Math.random()*0.008, vz: (Math.random()-.5)*0.003, life: life*(0.5+Math.random()*0.5), maxLife: life, startScale: s });
      }
    }

    // Clear old particles
    T.particles.forEach(p => { T.scene.remove(p.mesh); p.mesh.material.dispose(); });
    T.particles = [];

    // Square colors — warm ember for selected
    T.squares.forEach((mesh, sq) => {
      const isL = (FILES.indexOf(sq[0]) + RANKS.indexOf(sq[1])) % 2 === 0;
      const mat = mesh.material as THREE.MeshStandardMaterial;
      if (sq === selected) {
        mat.color.set(isL ? 0xf0a050 : 0xc07030); mat.emissive.set(0x802000); mat.emissiveIntensity = 0.6;
      } else if (lastMove && (lastMove.from === sq || lastMove.to === sq)) {
        mat.color.set(isL ? 0xf0d080 : 0xc09848); mat.emissive.set(0x403010); mat.emissiveIntensity = 0.2;
      } else if (kingInCheck === sq) {
        mat.color.set(0xff4444); mat.emissive.set(0x600000); mat.emissiveIntensity = 0.5;
      } else {
        mat.color.set(isL ? 0xe8d5aa : 0xa67c4e); mat.emissive.set(0x000000); mat.emissiveIntensity = 0;
      }
    });

    // Spawn fire on selected square
    if (selected) {
      const [sx, sz] = sq2world(selected[0], selected[1]);
      spawnFire(sx, sz, 12, [255, 140, 30], 0.25, 0.8);
      spawnFire(sx, sz, 6, [255, 60, 10], 0.18, 0.6);
    }

    // Legal moves — invisible hit targets + particle effects
    T.dots.forEach(d => { T.scene.remove(d); d.geometry.dispose(); });
    T.dots = [];
    if (selected && isMyTurn && !disabled) {
      legalMoves.forEach(sq => {
        const hasPiece = chess.get(sq as any);
        const [x, z] = sq2world(sq[0], sq[1]);
        if (hasPiece) {
          spawnFire(x, z, 8, [255, 50, 20], 0.2, 0.7);
          spawnFire(x, z, 4, [255, 200, 50], 0.15, 0.5);
        } else {
          spawnFire(x, z, 4, [150, 200, 255], 0.12, 0.5);
        }
        // Invisible cylinder for raycasting clicks
        const dotGeo = new THREE.CylinderGeometry(0.35, 0.35, 0.02, 8);
        const dotMat = new THREE.MeshStandardMaterial({ visible: false });
        const dot = new THREE.Mesh(dotGeo, dotMat);
        dot.position.set(x, 0.05, z); dot.userData.square = sq;
        T.scene.add(dot); T.dots.push(dot);
      });
    }

    // Continuous fire spawning while selected
    let fireInterval: number | null = null;
    if (selected) {
      fireInterval = window.setInterval(() => {
        if (!threeRef.current) return;
        const [sx, sz] = sq2world(selected[0], selected[1]);
        spawnFire(sx, sz, 3, [255, 140, 30], 0.22, 0.7);
        spawnFire(sx, sz, 1, [255, 60, 10], 0.15, 0.5);
        if (isMyTurn && !disabled) {
          legalMoves.forEach(sq => {
            const [x, z] = sq2world(sq[0], sq[1]);
            const hasPiece = chess.get(sq as any);
            if (hasPiece) spawnFire(x, z, 2, [255, 50, 20], 0.16, 0.5);
            else spawnFire(x, z, 1, [150, 200, 255], 0.1, 0.4);
          });
        }
      }, 120);
    }

    // Lift selected piece with warm glow
    T.pieces.forEach((mesh, sq) => {
      const mat = mesh.material as THREE.MeshStandardMaterial;
      if (sq === selected) {
        mesh.position.y = 0.3; mat.emissive.set(0x804020); mat.emissiveIntensity = 0.3;
      } else {
        mesh.position.y = 0.04; mat.emissive.set(0x000000); mat.emissiveIntensity = 0;
      }
    });

    return () => { if (fireInterval) clearInterval(fireInterval); };
  }, [selected, legalMoves, lastMove, kingInCheck, fen, myColor, isMyTurn, disabled, chess]);

  // ==== RENDER ====
  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', minHeight: '400px' }}>
      <div ref={containerRef} style={{ width: '100%', height: '100%', minHeight: '400px', cursor: isMyTurn && !disabled ? 'pointer' : 'default' }} />
      <div style={{ position: 'absolute', bottom: 8, right: 12, fontSize: '10px', color: 'rgba(200,200,220,0.3)', fontFamily: 'JetBrains Mono, monospace', pointerEvents: 'none' }}>
        Right-drag orbit · Scroll zoom
      </div>
      {promotion && (
        <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}>
          <div style={{ background: '#1f2330', border: '1px solid rgba(96,165,250,0.3)', borderRadius: '14px', padding: '20px' }}>
            <div style={{ fontSize: '13px', color: '#6b7280', textAlign: 'center', marginBottom: '12px' }}>Promote to:</div>
            <div style={{ display: 'flex', gap: '10px' }}>
              {['q', 'r', 'b', 'n'].map(p => {
                const c = myColor === 'white' ? 'w' : 'b';
                return (
                  <button key={p} onClick={() => { onMove(promotion.from, promotion.to, p); setPromotion(null); setSelected(null); }}
                    style={{ width: 60, height: 60, fontSize: 36, background: '#272b38', border: '1px solid rgba(96,165,250,0.2)', borderRadius: '10px', cursor: 'pointer', color: '#eef0f6', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    {PIECE_UNICODE[`${c}${p.toUpperCase()}`]}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
});

export default ChessBoard;