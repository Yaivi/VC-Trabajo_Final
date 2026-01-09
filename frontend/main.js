import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

/* ---------------------------------------------------------------- */
/* 🔧 CONFIGURACIÓN FINAL */
/* ---------------------------------------------------------------- */

const VIDEO_WIDTH = 640;
const VIDEO_HEIGHT = 480;
const FRUSTUM_SIZE = 20.0;

// EJES Y DIRECCIONES
const BONE_AXIS = 'x'; 

const RIGHT_ARM_DIR = -1; 
const LEFT_ARM_DIR = -1;

// CONSTANTES PARA PIERNAS
const LEG_SENSITIVITY = 0.5;
const MIN_LEG_ANGLE = -Math.PI * 0.4;
const MAX_LEG_ANGLE = Math.PI * 0.4;

const OFFSETS = {
    RightArm: 0, 
    LeftArm: 0,
    RightUpLeg: 0, 
    LeftUpLeg: 0,
    RightLeg: 0,
    LeftLeg: 0
};

const JOINT_NAMES = {
    RightArm: "RightArm", RightForeArm: "RightForeArm",
    LeftArm: "LeftArm", LeftForeArm: "LeftForeArm",
    RightUpLeg: "RightUpLeg", LeftUpLeg: "LeftUpLeg",
    RightLeg: "RightLeg", LeftLeg: "LeftLeg",
    Head: "Head"
};

let scene, camera, renderer, skeleton, socket, modelMesh;

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
/* LÓGICA DE MOVIMIENTO CORREGIDA - VERSIÓN FUNCIONAL */
/* ---------------------------------------------------------------- */

function updateSkeleton(kpts) {
    // DEBUG: Ver qué puntos estamos recibiendo realmente
    console.log("=== PUNTOS YOLOv8 ===");
    console.log("5-left_shoulder:", kpts[5]);
    console.log("6-right_shoulder:", kpts[6]);
    console.log("11-left_hip (cintura):", kpts[11]);
    console.log("12-right_hip (cintura):", kpts[12]);
    console.log("13-left_knee:", kpts[13]);
    console.log("14-right_knee:", kpts[14]);

    // Obtener puntos reales de YOLOv8
    const P = {
        // Brazos (funcionan bien)
        ls: toPoint(kpts[5]), le: toPoint(kpts[7]), lw: toPoint(kpts[9]),   
        rs: toPoint(kpts[6]), re: toPoint(kpts[8]), rw: toPoint(kpts[10]),
        
        // Puntos de pierna REALES (los que YOLO detecta)
        left_side: toPoint(kpts[11]),  // ¡NO es cadera! Es lado de cintura
        right_side: toPoint(kpts[12]), // ¡NO es cadera! Es lado de cintura
        lk: toPoint(kpts[13]), la: toPoint(kpts[15]), // Rodilla y tobillo izquierdo
        rk: toPoint(kpts[14]), ra: toPoint(kpts[16]), // Rodilla y tobillo derecho
        
        nose: toPoint(kpts[0])
    };

    // Normalizar todos los puntos
    const N = {};
    for (let key in P) {
        if (P[key] && (P[key].x !== 0 || P[key].y !== 0)) {
            N[key] = normalizePoint(P[key]);
        }
    }

    // --- CALCULAR CADERAS REALES ---
    // Método 1: Si tenemos hombro y rodilla, calcular cadera aproximada
    // Método 2: Si no, usar el punto lateral de la cintura ajustado
    
    // Cadera izquierda
    if (N.ls && N.lk) {
        // La cadera está entre el hombro y la rodilla, más cerca del hombro
        N.lh = {
            x: N.ls.x * 0.6 + N.lk.x * 0.4,
            y: N.ls.y * 0.7 + N.lk.y * 0.3
        };
    } else if (N.left_side) {
        // Usar el punto lateral ajustado hacia abajo
        N.lh = {
            x: N.left_side.x,
            y: N.left_side.y + 0.15  // Bajar un poco
        };
    } else {
        // Posición por defecto
        N.lh = { x: -0.2, y: 0 };
    }

    // Cadera derecha
    if (N.rs && N.rk) {
        N.rh = {
            x: N.rs.x * 0.6 + N.rk.x * 0.4,
            y: N.rs.y * 0.7 + N.rk.y * 0.3
        };
    } else if (N.right_side) {
        N.rh = {
            x: N.right_side.x,
            y: N.right_side.y + 0.15
        };
    } else {
        N.rh = { x: 0.2, y: 0 };
    }

    console.log("Cadera izq calculada:", N.lh);
    console.log("Cadera der calculada:", N.rh);
    console.log("Rodilla izq:", N.lk);
    console.log("Rodilla der:", N.rk);

    // --- BRAZOS (sin cambios) ---
    if (N.ls && N.le) {
        const angle = Math.atan2(N.le.y - N.ls.y, N.le.x - N.ls.x);
        applyRotation(JOINT_NAMES.LeftArm, angle, OFFSETS.LeftArm, LEFT_ARM_DIR);
        
        if (N.lw) {
             const angleFore = Math.atan2(N.lw.y - N.le.y, N.lw.x - N.le.x);
             applyRotation(JOINT_NAMES.LeftForeArm, angleFore - angle, 0, LEFT_ARM_DIR);
        }
    }

    if (N.rs && N.re) {
        let dy = N.re.y - N.rs.y;
        let dx = N.re.x - N.rs.x;
        const angleMirrored = Math.atan2(dy, -dx);
        applyRotation(JOINT_NAMES.RightArm, angleMirrored, OFFSETS.RightArm, RIGHT_ARM_DIR);
        
        if (N.rw) {
             let dyFore = N.rw.y - N.re.y;
             let dxFore = N.rw.x - N.re.x;
             const angleForeMirrored = Math.atan2(dyFore, -dxFore);
             applyRotation(JOINT_NAMES.RightForeArm, angleForeMirrored - angleMirrored, 0, RIGHT_ARM_DIR); 
        }
    }

    // --- PIERNA IZQUIERDA - SIMPLIFICADA Y FUNCIONAL ---
    if (N.lh && N.lk) {
        const dx = N.lk.x - N.lh.x;
        const dy = N.lk.y - N.lh.y;
        
        console.log("Pierna izq - dx:", dx.toFixed(3), "dy:", dy.toFixed(3));
        
        // Cálculo simple del ángulo
        // En reposo (pierna recta), dx ≈ 0, dy negativo (rodilla abajo de cadera)
        // Queremos que el ángulo sea 0 cuando la pierna está recta
        let angle = Math.atan2(-dy, dx); // Invertimos dy para que tenga sentido
        
        // Limitar y suavizar
        angle = THREE.MathUtils.clamp(angle * LEG_SENSITIVITY, MIN_LEG_ANGLE, MAX_LEG_ANGLE);
        
        // Aplicar rotación
        const bone = getBone(JOINT_NAMES.LeftUpLeg);
        if (bone) {
            bone.rotation.x = THREE.MathUtils.lerp(
                bone.rotation.x,
                angle,
                0.2
            );
        }
        
        // RODILLA (si tenemos tobillo)
        if (N.la) {
            const dxKnee = N.la.x - N.lk.x;
            const dyKnee = N.la.y - N.lk.y;
            
            // Ángulo entre muslo y espinilla
            let kneeAngle = Math.atan2(-dyKnee, dxKnee) * LEG_SENSITIVITY;
            kneeAngle = Math.max(0, kneeAngle - angle) * 0.3;
            
            const kneeBone = getBone(JOINT_NAMES.LeftLeg);
            if (kneeBone) {
                kneeBone.rotation.x = THREE.MathUtils.lerp(
                    kneeBone.rotation.x,
                    -kneeAngle,
                    0.2
                );
            }
        }
    } else {
        // Si no hay detección, volver a posición neutra
        const bone = getBone(JOINT_NAMES.LeftUpLeg);
        if (bone) {
            bone.rotation.x = THREE.MathUtils.lerp(bone.rotation.x, 0, 0.05);
        }
        const kneeBone = getBone(JOINT_NAMES.LeftLeg);
        if (kneeBone) {
            kneeBone.rotation.x = THREE.MathUtils.lerp(kneeBone.rotation.x, 0, 0.05);
        }
    }

    // --- PIERNA DERECHA - SIMPLIFICADA Y FUNCIONAL ---
    if (N.rh && N.rk) {
        const dx = N.rk.x - N.rh.x;
        const dy = N.rk.y - N.rh.y;
        
        console.log("Pierna der - dx:", dx.toFixed(3), "dy:", dy.toFixed(3));
        
        // Para pierna derecha, espejamos en X
        let angle = Math.atan2(-dy, -dx); // Espejado en X
        
        // Limitar y suavizar
        angle = THREE.MathUtils.clamp(angle * LEG_SENSITIVITY, MIN_LEG_ANGLE, MAX_LEG_ANGLE);
        
        // Aplicar rotación
        const bone = getBone(JOINT_NAMES.RightUpLeg);
        if (bone) {
            bone.rotation.x = THREE.MathUtils.lerp(
                bone.rotation.x,
                angle,
                0.2
            );
        }
        
        // RODILLA
        if (N.ra) {
            const dxKnee = N.ra.x - N.rk.x;
            const dyKnee = N.ra.y - N.rk.y;
            
            let kneeAngle = Math.atan2(-dyKnee, -dxKnee) * LEG_SENSITIVITY;
            kneeAngle = Math.max(0, kneeAngle - angle) * 0.3;
            
            const kneeBone = getBone(JOINT_NAMES.RightLeg);
            if (kneeBone) {
                kneeBone.rotation.x = THREE.MathUtils.lerp(
                    kneeBone.rotation.x,
                    -kneeAngle,
                    0.2
                );
            }
        }
    } else {
        // Si no hay detección, volver a posición neutra
        const bone = getBone(JOINT_NAMES.RightUpLeg);
        if (bone) {
            bone.rotation.x = THREE.MathUtils.lerp(bone.rotation.x, 0, 0.05);
        }
        const kneeBone = getBone(JOINT_NAMES.RightLeg);
        if (kneeBone) {
            kneeBone.rotation.x = THREE.MathUtils.lerp(kneeBone.rotation.x, 0, 0.05);
        }
    }
}

function applyRotation(boneName, angle, offset, directionFactor) {
    const bone = getBone(boneName);
    if (!bone) return;

    let finalRot = (angle * directionFactor) + offset;
    const speed = 0.5;

    bone.rotation.x = THREE.MathUtils.lerp(bone.rotation.x, finalRot, speed);
}

// NORMALIZACIÓN SIMPLE Y FUNCIONAL
function normalizePoint(p) { 
    if (!p || p.x === undefined || p.y === undefined) return null;
    
    // Normalización centrada
    // En la imagen: (0,0) = esquina superior izquierda
    // En Three.js: (0,0) = centro, Y positivo = arriba
    const x = ((p.x / VIDEO_WIDTH) - 0.5) * 2;   // -1 a 1, centrado
    const y = -((p.y / VIDEO_HEIGHT) - 0.5) * 2; // -1 a 1, centrado, invertido Y
    
    return { 
        x: x * 1.5,  // Escalar un poco
        y: y * 1.5
    }; 
}

function toPoint(raw) { 
    if (!raw) return null;
    
    if (Array.isArray(raw)) {
        // YOLOv8 devuelve [x, y, confidence]
        return { x: raw[0], y: raw[1] };
    } else if (raw.x !== undefined && raw.y !== undefined) {
        return raw;
    }
    return null;
}

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