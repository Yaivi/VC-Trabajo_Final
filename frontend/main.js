import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

/* ---------------------------------------------------------------- */
/* 🔧 ZONA DE REPARACIÓN INSTANTÁNEA */
/* ---------------------------------------------------------------- */

// CAMBIA ESTO SI EL BRAZO DERECHO SIGUE MAL:

// Opción A: Sumar 180 grados al brazo derecho (Corrige el fallo de "brazo invertido")
const FIX_RIGHT_ARM_OFFSET = true; 

// Opción B: Si al subir el brazo, el muñeco lo baja, cambia esto a -1
const RIGHT_ARM_DIRECTION = 1; 
const LEFT_ARM_DIRECTION = -1; // El izquierdo te iba bien invertido

/* ---------------------------------------------------------------- */
/* CONFIGURACIÓN STANDARD */
/* ---------------------------------------------------------------- */
const VIDEO_WIDTH = 640;
const VIDEO_HEIGHT = 480;
const FRUSTUM_SIZE = 20; 

const JOINT_NAMES = {
    RightArm: "RightArm", RightForeArm: "RightForeArm",
    LeftArm: "LeftArm", LeftForeArm: "LeftForeArm",
    RightUpLeg: "RightUpLeg", LeftUpLeg: "LeftUpLeg",
    Head: "Head"
};

let scene, camera, renderer, skeleton, socket, modelMesh;

function init() {
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x2a2a2a);

  const aspect = window.innerWidth / window.innerHeight;
  camera = new THREE.OrthographicCamera(
    FRUSTUM_SIZE * aspect / -2, FRUSTUM_SIZE * aspect / 2,
    FRUSTUM_SIZE / 2, FRUSTUM_SIZE / -2,
    0.1, 100
  );
  camera.position.set(0, 1.0, 5);
  camera.lookAt(0, 1.0, 0);

  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  document.body.appendChild(renderer.domElement);

  const light = new THREE.DirectionalLight(0xffffff, 1.5);
  light.position.set(0, 0, 10);
  scene.add(light);
  scene.add(new THREE.AmbientLight(0xffffff, 1.0));

  const loader = new GLTFLoader();
  loader.load("./assets/Rigged_Character.glb", (gltf) => {
    modelMesh = gltf.scene;
    scene.add(modelMesh);
    modelMesh.position.set(0, -1, 0);
    
    modelMesh.traverse((obj) => {
      if (obj.isSkinnedMesh && !skeleton) skeleton = obj.skeleton;
    });
    console.log("✅ Modelo Cargado - Corrección de Brazo Derecho Activada");

  }, undefined, (e) => console.error(e));

  connectWebSocket();
  window.addEventListener("resize", onWindowResize);
  animate();
}

function connectWebSocket() {
    socket = new WebSocket("ws://localhost:8000");
    socket.onmessage = (event) => {
        try {
            const data = JSON.parse(event.data);
            if (data.type === "pose" && data.keypoints) {
                let kpts = data.keypoints;
                if (Array.isArray(kpts) && kpts[0] && kpts[0].keypoints) kpts = kpts[0].keypoints;
                if (skeleton && kpts.length > 0) updateSkeleton(kpts);
            }
        } catch (e) {}
    };
    socket.onclose = () => setTimeout(connectWebSocket, 2000);
}

/* ---------------------------------------------------------------- */
/* LÓGICA DE MOVIMIENTO CON CORRECCIÓN DE 180 GRADOS */
/* ---------------------------------------------------------------- */

function updateSkeleton(kpts) {
    const P = {
        ls: toPoint(kpts[5]), le: toPoint(kpts[7]), lw: toPoint(kpts[9]),
        rs: toPoint(kpts[6]), re: toPoint(kpts[8]), rw: toPoint(kpts[10]),
        rh: toPoint(kpts[12]), rk: toPoint(kpts[14]),
        lh: toPoint(kpts[11]), lk: toPoint(kpts[13]),
        nose: toPoint(kpts[0])
    };

    const N = {};
    for (let key in P) {
        if (P[key] && (P[key].x !== 0 || P[key].y !== 0)) N[key] = normalizePoint(P[key]);
    }

    // --- BRAZO DERECHO (EL PROBLEMÁTICO) ---
    if (N.rs && N.re) {
        const angle = Math.atan2(N.re.y - N.rs.y, N.re.x - N.rs.x);
        
        // AQUÍ ESTÁ EL TRUCO: Si activamos FIX, sumamos PI (180 grados)
        let offset = FIX_RIGHT_ARM_OFFSET ? Math.PI : 0;
        
        applyRotation(JOINT_NAMES.RightArm, angle, offset, RIGHT_ARM_DIRECTION);
        
        if (N.rw) {
             const angleFore = Math.atan2(N.rw.y - N.re.y, N.rw.x - N.re.x);
             // El antebrazo también necesita heredar esa corrección
             applyRotation(JOINT_NAMES.RightForeArm, angleFore - angle, 0, RIGHT_ARM_DIRECTION); 
        }
    }

    // --- BRAZO IZQUIERDO (EL QUE IBA BIEN) ---
    if (N.ls && N.le) {
        const angle = Math.atan2(N.le.y - N.ls.y, N.le.x - N.ls.x);
        // El izquierdo generalmente no necesita el offset de PI si el modelo es estándar
        applyRotation(JOINT_NAMES.LeftArm, angle, 0, LEFT_ARM_DIRECTION);
        
        if (N.lw) {
             const angleFore = Math.atan2(N.lw.y - N.le.y, N.lw.x - N.le.x);
             applyRotation(JOINT_NAMES.LeftForeArm, angleFore - angle, 0, LEFT_ARM_DIRECTION);
        }
    }

    // --- PIERNAS ---
    if (N.rh && N.rk) {
        const angle = Math.atan2(N.rk.y - N.rh.y, N.rk.x - N.rh.x);
        applyRotation(JOINT_NAMES.RightUpLeg, angle, Math.PI/2, 1);
    }
    if (N.lh && N.lk) {
        const angle = Math.atan2(N.lk.y - N.lh.y, N.lk.x - N.lh.x);
        applyRotation(JOINT_NAMES.LeftUpLeg, angle, Math.PI/2, -1);
    }
}

function applyRotation(boneName, angle, offset, directionFactor) {
    const bone = getBone(boneName);
    if (!bone) return;

    // Fórmula Maestra
    let finalRot = (angle * directionFactor) + offset;
    const speed = 0.5;

    // Reseteo
    bone.rotation.set(0, 0, 0);

    // EJE X es el que elegimos como ganador
    bone.rotation.x = THREE.MathUtils.lerp(bone.rotation.x, finalRot, speed);
}

function toPoint(raw) { return (Array.isArray(raw)) ? { x: raw[0], y: raw[1] } : raw; }
function normalizePoint(p) { return { x: (p.x / VIDEO_WIDTH) * 2 - 1, y: -( (p.y / VIDEO_HEIGHT) * 2 - 1 ) }; }

function getBone(baseName) {
    if (!skeleton) return null;
    let bone = skeleton.getBoneByName(baseName);
    if (!bone) bone = skeleton.getBoneByName("mixamorig" + baseName);
    return bone;
}

function onWindowResize() {
    const aspect = window.innerWidth / window.innerHeight;
    camera.left = -FRUSTUM_SIZE * aspect / 2;
    camera.right = FRUSTUM_SIZE * aspect / 2;
    camera.top = FRUSTUM_SIZE / 2;
    camera.bottom = -FRUSTUM_SIZE / 2;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}

function animate() {
  requestAnimationFrame(animate);
  renderer.render(scene, camera);
}

init();