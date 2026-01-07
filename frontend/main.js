import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

/* ---------------------------------------------------------------- */
/* 🔧 AJUSTES DE DIRECCIÓN (MODIFICA ESTO SI VAN AL REVÉS) */
/* ---------------------------------------------------------------- */

// Si levantas el brazo y el muñeco lo baja, cambia 1 por -1
const ARM_DIRECTION = 1;    

// Si mueves la pierna adelante y el muñeco la mueve atrás, cambia -1 por 1
const LEG_DIRECTION = -1;   

/* ---------------------------------------------------------------- */
/* CONFIGURACIÓN */
/* ---------------------------------------------------------------- */
const VIDEO_WIDTH = 640;
const VIDEO_HEIGHT = 480;

const JOINT_NAMES = {
    RightArm: "RightArm", RightForeArm: "RightForeArm",
    LeftArm: "LeftArm", LeftForeArm: "LeftForeArm",
    RightUpLeg: "RightUpLeg", LeftUpLeg: "LeftUpLeg",
    Head: "Head"
};

let scene, camera, renderer;
let skeleton = null;
let socket = null;
let modelMesh = null;

// Ayudas visuales (Esferas para ver si llegan datos)
let debugHelpers = {}; 

function init() {
  // 1. Escena
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x222222);

  // 2. Cámara
  camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 100);
  camera.position.set(0, 1.2, 5); 
  camera.lookAt(0, 0.8, 0);

  // 3. Luces
  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  document.body.appendChild(renderer.domElement);

  const ambientLight = new THREE.AmbientLight(0xffffff, 1.0);
  scene.add(ambientLight);
  const dirLight = new THREE.DirectionalLight(0xffffff, 2.0);
  dirLight.position.set(2, 5, 5);
  scene.add(dirLight);

  // 4. Cargar Modelo
  const loader = new GLTFLoader();
  loader.load("./assets/Rigged_Character.glb", (gltf) => {
    modelMesh = gltf.scene;
    scene.add(modelMesh);
    modelMesh.position.set(0, -1, 0); 
    modelMesh.scale.set(0.15, 0.15,0.15); 

    modelMesh.traverse((obj) => {
      if (obj.isSkinnedMesh && !skeleton) skeleton = obj.skeleton;
    });
    console.log("✅ Modelo cargado.");

  }, undefined, (e) => console.error(e));

  // Crear indicadores visuales (debug)
  createDebugSphere("LeftHand", -1, 1, 0); // Esfera Izquierda
  createDebugSphere("RightHand", 1, 1, 0); // Esfera Derecha

  connectWebSocket();
  window.addEventListener("resize", onWindowResize);
  animate();
}

function createDebugSphere(name, x, y, z) {
    const geo = new THREE.SphereGeometry(0.1);
    const mat = new THREE.MeshBasicMaterial({ color: 0xff0000 }); // Rojo = No detectado
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, y, z);
    scene.add(mesh);
    debugHelpers[name] = mesh;
}

/* ---------------------------------------------------------------- */
/* WEBSOCKET */
/* ---------------------------------------------------------------- */
function connectWebSocket() {
    socket = new WebSocket("ws://localhost:8000");
    socket.onopen = () => console.log("✅ WebSocket conectado");
    
    socket.onmessage = (event) => {
        try {
            const data = JSON.parse(event.data);
            if (data.type === "pose" && data.keypoints) {
                let kpts = data.keypoints;
                if (Array.isArray(kpts) && kpts[0] && kpts[0].keypoints) {
                    kpts = kpts[0].keypoints;
                }
                
                if (skeleton && kpts.length > 0) {
                    processPose(kpts);
                }
            }
        } catch (e) { console.error(e); }
    };
    
    socket.onclose = () => setTimeout(connectWebSocket, 3000);
}

/* ---------------------------------------------------------------- */
/* LÓGICA SIN RESETEO (FREEZE MODE) */
/* ---------------------------------------------------------------- */
function processPose(kpts) {
    
    // Puntos necesarios
    const P = {
        ls: toPoint(kpts[5]), le: toPoint(kpts[7]), lw: toPoint(kpts[9]),   // Brazo Izq
        rs: toPoint(kpts[6]), re: toPoint(kpts[8]), rw: toPoint(kpts[10]),  // Brazo Der
        lh: toPoint(kpts[11]), lk: toPoint(kpts[13]),                       // Pierna Izq
        rh: toPoint(kpts[12]), rk: toPoint(kpts[14]),                       // Pierna Der
        nose: toPoint(kpts[0])
    };

    // Normalizar
    const N = {};
    for (let key in P) {
        if (P[key] && (P[key].x !== 0 || P[key].y !== 0)) N[key] = normalizePoint(P[key]);
    }

    // DEBUG: Iluminar esferas si detectamos manos
    if (N.lw) debugHelpers["LeftHand"].material.color.set(0x00ff00); // Verde si ve mano izq
    else debugHelpers["LeftHand"].material.color.set(0xff0000);      // Rojo si la pierde

    if (N.rw) debugHelpers["RightHand"].material.color.set(0x00ff00);
    else debugHelpers["RightHand"].material.color.set(0xff0000);


    // --- BRAZO DERECHO ---
    const bRA = getBone(JOINT_NAMES.RightArm);
    const bRFA = getBone(JOINT_NAMES.RightForeArm);
    
    if (bRA && bRFA && N.rs && N.re && N.rw) {
        // Hombro
        const angArm = getAngle(N.rs, N.re);
        bRA.rotation.z = THREE.MathUtils.lerp(bRA.rotation.z, angArm * ARM_DIRECTION, 0.5);
        
        // Codo
        let angElbow = getAngle(N.re, N.rw) - angArm;
        while (angElbow <= -Math.PI) angElbow += Math.PI*2;
        while (angElbow > Math.PI) angElbow -= Math.PI*2;
        angElbow = THREE.MathUtils.clamp(angElbow, 0, 2.5); // Limitar flexión
        
        bRFA.rotation.z = THREE.MathUtils.lerp(bRFA.rotation.z, angElbow, 0.5);
        
        // Limpiar rotaciones basura
        bRA.rotation.x = 0; bRA.rotation.y = 0;
    }

    // --- BRAZO IZQUIERDO ---
    const bLA = getBone(JOINT_NAMES.LeftArm);
    const bLFA = getBone(JOINT_NAMES.LeftForeArm);
    
    if (bLA && bLFA && N.ls && N.le && N.lw) {
        const angArm = getAngle(N.ls, N.le);
        bLA.rotation.z = THREE.MathUtils.lerp(bLA.rotation.z, angArm * ARM_DIRECTION, 0.5);

        let angElbow = getAngle(N.le, N.lw) - angArm;
        while (angElbow <= -Math.PI) angElbow += Math.PI*2;
        while (angElbow > Math.PI) angElbow -= Math.PI*2;
        angElbow = THREE.MathUtils.clamp(angElbow, -2.5, 0);
        
        bLFA.rotation.z = THREE.MathUtils.lerp(bLFA.rotation.z, angElbow, 0.5);
        
        bLA.rotation.x = 0; bLA.rotation.y = 0;
    }

    // --- PIERNAS ---
    const bRUL = getBone(JOINT_NAMES.RightUpLeg);
    if (bRUL && N.rh && N.rk) {
        let legAngle = getAngle(N.rh, N.rk);
        // +90 grados offset, multiplicado por dirección
        let finalAngle = (legAngle + Math.PI/2) * LEG_DIRECTION;
        bRUL.rotation.x = THREE.MathUtils.lerp(bRUL.rotation.x, finalAngle, 0.5);
        bRUL.rotation.z = 0;
    }

    const bLUL = getBone(JOINT_NAMES.LeftUpLeg);
    if (bLUL && N.lh && N.lk) {
        let legAngle = getAngle(N.lh, N.lk);
        let finalAngle = (legAngle + Math.PI/2) * LEG_DIRECTION;
        bLUL.rotation.x = THREE.MathUtils.lerp(bLUL.rotation.x, finalAngle, 0.5);
        bLUL.rotation.z = 0;
    }
}

/* ---------------------------------------------------------------- */
/* UTILIDADES */
/* ---------------------------------------------------------------- */
function toPoint(raw) { return (Array.isArray(raw)) ? { x: raw[0], y: raw[1] } : raw; }
function normalizePoint(p) { return { x: (p.x / VIDEO_WIDTH) * 2 - 1, y: -((p.y / VIDEO_HEIGHT) * 2 - 1) }; }
function getAngle(p1, p2) { return Math.atan2(p2.y - p1.y, p2.x - p1.x); }

function getBone(baseName) {
    if (!skeleton) return null;
    let bone = skeleton.getBoneByName(baseName);
    if (!bone) bone = skeleton.getBoneByName("mixamorig" + baseName);
    return bone;
}

function onWindowResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}

function animate() {
  requestAnimationFrame(animate);
  // NO HAY CHECKTIMEOUTS -> NO SE RESETEA
  renderer.render(scene, camera);
}

init();