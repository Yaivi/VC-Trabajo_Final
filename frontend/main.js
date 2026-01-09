import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

/* ---------------------------------------------------------------- */
/* 🔧 CONFIGURACIÓN FINAL */
/* ---------------------------------------------------------------- */

const VIDEO_WIDTH = 640;
const VIDEO_HEIGHT = 480;
const FRUSTUM_SIZE = 20.0; // Aumentado para ver más espacio (Zoom Out)

// EJES Y DIRECCIONES
const BONE_AXIS = 'x'; 

// Si con 1 sube cuando tú subes, déjalo en 1.
// Si sube cuando tú bajas, ponlo en -1.
const RIGHT_ARM_DIR = -1; 
const LEFT_ARM_DIR = -1;

const OFFSETS = {
    RightArm: 0, 
    LeftArm: 0,
    RightUpLeg: Math.PI / 2, 
    LeftUpLeg: Math.PI / 2
};

const JOINT_NAMES = {
    RightArm: "RightArm", RightForeArm: "RightForeArm",
    LeftArm: "LeftArm", LeftForeArm: "LeftForeArm",
    RightUpLeg: "RightUpLeg", LeftUpLeg: "LeftUpLeg",
    Head: "Head"
};

let scene, camera, renderer, skeleton, socket, modelMesh;

function init() {
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x202020); // Gris muy oscuro

  // CÁMARA ORTOGRÁFICA
  const aspect = window.innerWidth / window.innerHeight;
  camera = new THREE.OrthographicCamera(
    FRUSTUM_SIZE * aspect / -2, FRUSTUM_SIZE * aspect / 2,
    FRUSTUM_SIZE / 2, FRUSTUM_SIZE / -2,
    0.1, 100
  );
  
  // Posición centrada y alejada
  camera.position.set(0, 0, 10);
  camera.lookAt(0, 0, 0);

  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  document.body.appendChild(renderer.domElement);

  // LUCES
  const light = new THREE.DirectionalLight(0xffffff, 2.0);
  light.position.set(0, 2, 10);
  scene.add(light);
  scene.add(new THREE.AmbientLight(0xffffff, 1.0));


  const loader = new GLTFLoader();
  loader.load("./assets/Rigged_Character.glb", (gltf) => {
    modelMesh = gltf.scene;
    scene.add(modelMesh);
    
    // Centramos el modelo manualmente
    // Ajusta la 'y' (-1.0) si el modelo está muy alto o bajo respecto al cubo rojo
    modelMesh.position.set(0, -1.0, 0);
    modelMesh.scale.set(1, 1, 1);
    
    modelMesh.traverse((obj) => {
      if (obj.isSkinnedMesh && !skeleton) skeleton = obj.skeleton;
    });

  }, undefined, (e) => console.error("Error cargando modelo:", e));

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
/* LÓGICA DE MOVIMIENTO */
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

    // --- BRAZO IZQUIERDO (Base) ---
    if (N.ls && N.le) {
        const angle = Math.atan2(N.le.y - N.ls.y, N.le.x - N.ls.x);
        applyRotation(JOINT_NAMES.LeftArm, angle, OFFSETS.LeftArm, LEFT_ARM_DIR);
        
        if (N.lw) {
             const angleFore = Math.atan2(N.lw.y - N.le.y, N.lw.x - N.le.x);
             applyRotation(JOINT_NAMES.LeftForeArm, angleFore - angle, 0, LEFT_ARM_DIR);
        }
    }

    // --- BRAZO DERECHO (Espejo + Dirección Corregida) ---
    if (N.rs && N.re) {
        let dy = N.re.y - N.rs.y;
        let dx = N.re.x - N.rs.x;

        // Espejamos X (-dx) para usar la matemática del lado izquierdo (que funciona bien)
        const angleMirrored = Math.atan2(dy, -dx);
        
        // Aplicamos con la dirección corregida (1)
        applyRotation(JOINT_NAMES.RightArm, angleMirrored, OFFSETS.RightArm, RIGHT_ARM_DIR);
        
        if (N.rw) {
             let dyFore = N.rw.y - N.re.y;
             let dxFore = N.rw.x - N.re.x;
             const angleForeMirrored = Math.atan2(dyFore, -dxFore);
             
             applyRotation(JOINT_NAMES.RightForeArm, angleForeMirrored - angleMirrored, 0, RIGHT_ARM_DIR); 
        }
    }

    // --- PIERNAS ---
    if (N.rh && N.rk) {
        let dy = N.rk.y - N.rh.y;
        let dx = N.rk.x - N.rh.x;
        const angle = Math.atan2(dy, -dx); // Espejamos también la pierna derecha
        applyRotation(JOINT_NAMES.RightUpLeg, angle, OFFSETS.RightUpLeg, 1);
    }
    if (N.lh && N.lk) {
        const angle = Math.atan2(N.lk.y - N.lh.y, N.lk.x - N.lh.x);
        applyRotation(JOINT_NAMES.LeftUpLeg, angle, OFFSETS.LeftUpLeg, -1);
    }
}

function applyRotation(boneName, angle, offset, directionFactor) {
    const bone = getBone(boneName);
    if (!bone) return;

    let finalRot = (angle * directionFactor) + offset;
    const speed = 0.5;

    // Bloqueamos otros ejes para forzar 2D plano
    bone.rotation.set(0, 0, 0);

    // EJE X (Según tus pruebas era el bueno)
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