import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

/* ---------------------------------------------------------------- */
/* 🔧 CONFIGURACIÓN */
/* ---------------------------------------------------------------- */

let IS_MIRROR_MODE = true; // Empieza en modo espejo

// DIRECCIONES (Ajusta si alguno va al revés)
const RIGHT_ARM_DIR = -1; 
const LEFT_ARM_DIR = -1;

const VIDEO_WIDTH = 640;
const VIDEO_HEIGHT = 480;
const FRUSTUM_SIZE = 20.0;

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

// Texto de Info
const infoDiv = document.createElement('div');
infoDiv.style.position = 'absolute';
infoDiv.style.top = '20px';
infoDiv.style.left = '20px';
infoDiv.style.color = '#00ff00';
infoDiv.style.fontFamily = 'monospace';
infoDiv.style.fontSize = '20px';
infoDiv.style.fontWeight = 'bold';
infoDiv.style.textShadow = '1px 1px 0 #000';
infoDiv.style.pointerEvents = 'none';
document.body.appendChild(infoDiv);

function updateInfoText() {
    infoDiv.innerText = `[M] MODO: ${IS_MIRROR_MODE ? "VIDEO" : "ESPEJO"}`;
    infoDiv.style.color = IS_MIRROR_MODE ? "#00ff00" : "#ffaa00";
}

function init() {
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x202020);

  const aspect = window.innerWidth / window.innerHeight;
  camera = new THREE.OrthographicCamera(
    FRUSTUM_SIZE * aspect / -2, FRUSTUM_SIZE * aspect / 2,
    FRUSTUM_SIZE / 2, FRUSTUM_SIZE / -2,
    0.1, 100
  );
  camera.position.set(0, 0, 10);
  camera.lookAt(0, 0, 0);

  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  document.body.appendChild(renderer.domElement);

  const light = new THREE.DirectionalLight(0xffffff, 2.0);
  light.position.set(0, 2, 10);
  scene.add(light);
  scene.add(new THREE.AmbientLight(0xffffff, 1.0));



  const loader = new GLTFLoader();
  loader.load("./assets/Rigged_Character.glb", (gltf) => {
    modelMesh = gltf.scene;
    scene.add(modelMesh);
    modelMesh.position.set(0, -5.0, 0);
    modelMesh.traverse((obj) => {
      if (obj.isSkinnedMesh && !skeleton) skeleton = obj.skeleton;
    });
    console.log(" Modelo cargado ");
  }, undefined, (e) => console.error(e));

  window.addEventListener('keydown', (e) => {
      if (e.key === 'm' || e.key === 'M') {
          IS_MIRROR_MODE = !IS_MIRROR_MODE;
          updateInfoText();
      }
  });

  updateInfoText();
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
/* LÓGICA DE MOVIMIENTO INTELIGENTE */
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

    // Estructuras de datos
    let inLeft = { s: N.ls, e: N.le, w: N.lw }; // Input Izquierdo
    let inRight = { s: N.rs, e: N.re, w: N.rw }; // Input Derecho
    
    let inLegLeft = { h: N.lh, k: N.lk };
    let inLegRight = { h: N.rh, k: N.rk };

    // --- INTERCAMBIO INTELIGENTE (LA CLAVE) ---
    // Si estamos en modo CRUZADO, no solo intercambiamos,
    // también INVERTIMOS la X (Flip) para corregir la dirección.
    
    let targetLeft, targetRight, targetLegLeft, targetLegRight;

    if (IS_MIRROR_MODE) {
        // Modo Espejo: Directo (Tu Izq -> Su Izq)
        targetLeft = inLeft;
        targetRight = inRight;
        targetLegLeft = inLegLeft;
        targetLegRight = inLegRight;
    } else {
        // Modo Cruzado: (Tu Izq -> Su Der)
        // Usamos flipPoints para que el brazo izquierdo parezca geométricamente un brazo derecho
        targetLeft = flipStructure(inRight); 
        targetRight = flipStructure(inLeft); 
        
        targetLegLeft = flipStructure(inLegRight);
        targetLegRight = flipStructure(inLegLeft);
    }

    // --- APLICAR AL ESQUELETO ---
    
    // 1. BRAZO IZQUIERDO DEL MUÑECO
    if (targetLeft.s && targetLeft.e) {
        const angle = Math.atan2(targetLeft.e.y - targetLeft.s.y, targetLeft.e.x - targetLeft.s.x);
        applyRotation(JOINT_NAMES.LeftArm, angle, OFFSETS.LeftArm, LEFT_ARM_DIR);
        
        if (targetLeft.w) {
             const angleFore = Math.atan2(targetLeft.w.y - targetLeft.e.y, targetLeft.w.x - targetLeft.e.x);
             applyRotation(JOINT_NAMES.LeftForeArm, angleFore - angle, 0, LEFT_ARM_DIR);
        }
    }

    // 2. BRAZO DERECHO DEL MUÑECO (Usando lógica de espejo -dx)
    if (targetRight.s && targetRight.e) {
        let dy = targetRight.e.y - targetRight.s.y;
        let dx = targetRight.e.x - targetRight.s.x;

        // Mantemos la lógica de espejo (-dx) para que el hueso derecho funcione suave
        const angleMirrored = Math.atan2(dy, -dx);
        applyRotation(JOINT_NAMES.RightArm, angleMirrored, OFFSETS.RightArm, RIGHT_ARM_DIR);
        
        if (targetRight.w) {
             let dyFore = targetRight.w.y - targetRight.e.y;
             let dxFore = targetRight.w.x - targetRight.e.x;
             const angleForeMirrored = Math.atan2(dyFore, -dxFore);
             applyRotation(JOINT_NAMES.RightForeArm, angleForeMirrored - angleMirrored, 0, RIGHT_ARM_DIR); 
        }
    }

    // 3. PIERNAS
    if (targetLegRight.h && targetLegRight.k) {
        let dy = targetLegRight.k.y - targetLegRight.h.y;
        let dx = targetLegRight.k.x - targetLegRight.h.x;
        const angle = Math.atan2(dy, -dx);
        applyRotation(JOINT_NAMES.RightUpLeg, angle, OFFSETS.RightUpLeg, 1);
    }
    if (targetLegLeft.h && targetLegLeft.k) {
        const angle = Math.atan2(targetLegLeft.k.y - targetLegLeft.h.y, targetLegLeft.k.x - targetLegLeft.h.x);
        applyRotation(JOINT_NAMES.LeftUpLeg, angle, OFFSETS.LeftUpLeg, -1);
    }
}

// Función auxiliar para invertir X en todos los puntos de un brazo/pierna
function flipStructure(obj) {
    let newObj = {};
    for (let key in obj) {
        if (obj[key]) {
            newObj[key] = { x: -obj[key].x, y: obj[key].y }; // FLIP X AQUÍ
        }
    }
    return newObj;
}

function applyRotation(boneName, angle, offset, directionFactor) {
    const bone = getBone(boneName);
    if (!bone) return;

    let finalRot = (angle * directionFactor) + offset;
    const speed = 0.5;

    bone.rotation.set(0, 0, 0);
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