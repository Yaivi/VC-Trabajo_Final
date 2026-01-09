import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

/* ---------------------------------------------------------------- */
/* 🔧 CONFIGURACIÓN COMPLETA */
/* ---------------------------------------------------------------- */

let IS_MIRROR_MODE = true; 

// DIRECCIONES
const RIGHT_ARM_DIR = -1; 
const LEFT_ARM_DIR = -1;

const VIDEO_WIDTH = 640;
const VIDEO_HEIGHT = 480;

// Ajustamos offsets - PRUEBA con 0 o Math.PI/2 según necesites
const OFFSETS = {
    RightArm: 0, 
    LeftArm: 0,
    RightUpLeg: 0,  // Cambia a 0 si las piernas están torcidas
    LeftUpLeg: 0    // Cambia a 0 si las piernas están torcidas
};

const JOINT_NAMES = {
    RightArm: "RightArm", RightForeArm: "RightForeArm",
    LeftArm: "LeftArm", LeftForeArm: "LeftForeArm",
    RightUpLeg: "RightUpLeg", LeftUpLeg: "LeftUpLeg",
    Head: "Head"
};

let scene, camera, renderer, skeleton, socket, modelMesh;

const infoDiv = document.createElement('div');
infoDiv.style.position = 'absolute';
infoDiv.style.top = '20px';
infoDiv.style.left = '20px';
infoDiv.style.color = '#00ff00';
infoDiv.style.fontFamily = 'monospace';
infoDiv.style.fontSize = '16px';
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
  scene.background = new THREE.Color(0xa0a0a0);
  scene.fog = new THREE.Fog(0xa0a0a0, 20, 60);

  // 1. CÁMARA DE PERSPECTIVA (ALEJADA)
  camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 100);
  
  // CAMBIO CLAVE: Z = 14 (Antes era 5 o 6). Esto aleja mucho la cámara.
  // Y = 1.0 (Altura de la cintura para centrarlo verticalmente)
  camera.position.set(0, 1.0, 14); 
  
  camera.lookAt(0, 0.0, 0); // Mirar al centro del cuerpo

  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true; 
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  document.body.appendChild(renderer.domElement);

  // 2. ILUMINACIÓN
  const hemiLight = new THREE.HemisphereLight(0xffffff, 0x444444, 0.6);
  hemiLight.position.set(0, 20, 0);
  scene.add(hemiLight);

  const dirLight = new THREE.DirectionalLight(0xffffff, 1.5);
  dirLight.position.set(3, 10, 10);
  dirLight.castShadow = true; 
  scene.add(dirLight);

  // 3. SUELO
  const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(100, 100),
      new THREE.MeshPhongMaterial({ color: 0x999999, depthWrite: false })
  );
  mesh.rotation.x = -Math.PI / 2;
  mesh.receiveShadow = true; 
  mesh.position.y = -1.0; // Bajamos el suelo para que coincida con los pies
  scene.add(mesh);

  // Cargar Modelo
  const loader = new GLTFLoader();
  loader.load("./assets/Rigged_Character.glb", (gltf) => {
    modelMesh = gltf.scene;
    scene.add(modelMesh);
    
    // POSICIÓN: Bajamos el modelo un poco para que los pies toquen el suelo (-1)
    modelMesh.position.set(0, -1.0, 0); 
    
    // ESCALA: Si aún se ve grande, baja estos números (ej: 0.8, 0.8, 0.8)
    modelMesh.scale.set(0.4, 0.4, 0.4); 
    
    modelMesh.traverse((obj) => {
      if (obj.isSkinnedMesh) {
          skeleton = obj.skeleton;
          obj.castShadow = true;    
          obj.receiveShadow = true; 
      }
    });
    console.log("✅ Modelo cargado y alejado");

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
/* LÓGICA DE MOVIMIENTO MEJORADA */
/* ---------------------------------------------------------------- */

function updateSkeleton(kpts) {
    // OBTENER PUNTOS EXACTAMENTE COMO EL SEGUNDO CÓDIGO
    const P = {
        ls: toPoint(kpts[5]), le: toPoint(kpts[7]), lw: toPoint(kpts[9]),   
        rs: toPoint(kpts[6]), re: toPoint(kpts[8]), rw: toPoint(kpts[10]),  
        rh: toPoint(kpts[12]), rk: toPoint(kpts[14]),
        lh: toPoint(kpts[11]), lk: toPoint(kpts[13]),
        nose: toPoint(kpts[0])
    };

    // NORMALIZAR EXACTAMENTE COMO EL SEGUNDO CÓDIGO
    const N = {};
    for (let key in P) {
        if (P[key] && (P[key].x !== 0 || P[key].y !== 0)) {
            N[key] = normalizePoint(P[key]);
        }
    }

    // --- PARA BRAZOS: USAR LÓGICA DE MODO ESPEJO ---
    let targetLeft, targetRight;
    
    if (IS_MIRROR_MODE) {
        // MODO VIDEO: usar puntos originales para brazos
        targetLeft = { s: N.ls, e: N.le, w: N.lw };
        targetRight = { s: N.rs, e: N.re, w: N.rw };
    } else {
        // MODO ESPEJO: intercambiar lados para brazos
        targetLeft = { s: {x: -N.rs?.x || 0, y: N.rs?.y || 0}, 
                      e: {x: -N.re?.x || 0, y: N.re?.y || 0}, 
                      w: {x: -N.rw?.x || 0, y: N.rw?.y || 0} };
        targetRight = { s: {x: -N.ls?.x || 0, y: N.ls?.y || 0}, 
                       e: {x: -N.le?.x || 0, y: N.le?.y || 0}, 
                       w: {x: -N.lw?.x || 0, y: N.lw?.y || 0} };
    }

    // --- BRAZOS CON MODO ESPEJO ---
    if (targetLeft.s && targetLeft.e) {
        const angle = Math.atan2(targetLeft.e.y - targetLeft.s.y, targetLeft.e.x - targetLeft.s.x);
        applyRotation(JOINT_NAMES.LeftArm, angle, OFFSETS.LeftArm, LEFT_ARM_DIR);
        
        if (targetLeft.w) {
             const angleFore = Math.atan2(targetLeft.w.y - targetLeft.e.y, targetLeft.w.x - targetLeft.e.x);
             applyRotation(JOINT_NAMES.LeftForeArm, angleFore - angle, 0, LEFT_ARM_DIR);
        }
    }

    if (targetRight.s && targetRight.e) {
        let dy = targetRight.e.y - targetRight.s.y;
        let dx = targetRight.e.x - targetRight.s.x;

        const angleMirrored = Math.atan2(dy, -dx);
        applyRotation(JOINT_NAMES.RightArm, angleMirrored, OFFSETS.RightArm, RIGHT_ARM_DIR);
        
        if (targetRight.w) {
             let dyFore = targetRight.w.y - targetRight.e.y;
             let dxFore = targetRight.w.x - targetRight.e.x;
             const angleForeMirrored = Math.atan2(dyFore, -dxFore);
             applyRotation(JOINT_NAMES.RightForeArm, angleForeMirrored - angleMirrored, 0, RIGHT_ARM_DIR); 
        }
    }

    // --- PIERNAS: USAR EXACTAMENTE LA LÓGICA DEL SEGUNDO CÓDIGO SIN MODO ESPEJO ---
    // El segundo código NO tiene modo espejo para piernas
    // Si quieres modo espejo para piernas, debemos intercambiar lados
    
    let piernaIzqHip, piernaIzqKnee, piernaDerHip, piernaDerKnee;
    
    if (IS_MIRROR_MODE) {
        // MODO VIDEO: puntos originales
        piernaIzqHip = N.lh;
        piernaIzqKnee = N.lk;
        piernaDerHip = N.rh;
        piernaDerKnee = N.rk;
    } else {
        // MODO ESPEJO: intercambiar lados
        piernaIzqHip = N.rh;
        piernaIzqKnee = N.rk;
        piernaDerHip = N.lh;
        piernaDerKnee = N.lk;
    }

    // ---------- PIERNA IZQUIERDA ----------
    if (piernaIzqHip && piernaIzqKnee) {
        const dx = piernaIzqKnee.x - piernaIzqHip.x;
        const dy = piernaIzqKnee.y - piernaIzqHip.y;

        // Ángulo respecto a la vertical (COPIADO DEL SEGUNDO CÓDIGO)
        let angle = Math.atan2(dx, dy);

        // Clamp humano (adelante / atrás)
        angle = THREE.MathUtils.clamp(angle, -0.8, 0.8);

        // Dead zone (anti-temblor)
        if (Math.abs(angle) < 0.05) angle = 0;

        applyRotation(JOINT_NAMES.LeftUpLeg, angle, OFFSETS.LeftUpLeg, -1);
    }

    // ---------- PIERNA DERECHA ----------
    if (piernaDerHip && piernaDerKnee) {
        const dx = piernaDerKnee.x - piernaDerHip.x;
        const dy = piernaDerKnee.y - piernaDerHip.y;

        let angle = Math.atan2(dx, dy);

        angle = THREE.MathUtils.clamp(angle, -0.8, 0.8);
        if (Math.abs(angle) < 0.05) angle = 0;

        applyRotation(JOINT_NAMES.RightUpLeg, angle, OFFSETS.RightUpLeg, 1);
    }
}

function applyRotation(boneName, angle, offset, directionFactor) {
    const bone = getBone(boneName);
    if (!bone) return;

    let finalRot = (angle * directionFactor) + offset;
    const speed = 0.5;

    bone.rotation.x = THREE.MathUtils.lerp(bone.rotation.x, finalRot, speed);
}

function toPoint(raw) { 
    if (!raw) return null;
    return (Array.isArray(raw)) ? { x: raw[0], y: raw[1] } : raw; 
}

function normalizePoint(p) { 
    if (!p || p.x === undefined || p.y === undefined) return null;
    
    // NORMALIZACIÓN EXACTA DEL SEGUNDO CÓDIGO
    return { 
        x: (p.x / VIDEO_WIDTH) * 2 - 1, 
        y: -((p.y / VIDEO_HEIGHT) * 2 - 1) 
    }; 
}

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
  renderer.render(scene, camera);
}

init();