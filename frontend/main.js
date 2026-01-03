import * as THREE from "./libs/three.module.js";
import { GLTFLoader } from "./libs/GLTFLoader.js";

/* ---------------------------------------------------------------- */
/* CONFIG / DEBUG */
/* ---------------------------------------------------------------- */
const DEBUG = true;            // poner false para producción
const DEBUG_EVERY_N_FRAMES = 10; // periodicidad de logs (para no spam)
const SHOW_BONE_HELPERS = false; // dibuja AxesHelper en huesos (útil para debugging)

/* ---------------------------------------------------------------- */
/* VARIABLES GLOBALES */
/* ---------------------------------------------------------------- */

let scene, camera, renderer;
let skeleton = null;
let socket = null;

let latestKeypoints = null;
let frameCounter = 0;

const VIDEO_WIDTH = 640;
const VIDEO_HEIGHT = 480;

/* ---------------------------------------------------------------- */
/* INICIO / CARGA MODELO */
/* ---------------------------------------------------------------- */

function init() {
  /* ESCENA */
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x222222);

  camera = new THREE.PerspectiveCamera(
    45,
    window.innerWidth / window.innerHeight,
    0.1,
    100
  );
  camera.position.set(0, 10, 30);
  camera.lookAt(0, 10, 0);

  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(window.devicePixelRatio);
  document.body.appendChild(renderer.domElement);

  scene.add(new THREE.AmbientLight(0xffffff, 0.6));
  const dirLight = new THREE.DirectionalLight(0xffffff, 1);
  dirLight.position.set(2, 5, 2);
  scene.add(dirLight);

  const loader = new GLTFLoader();

  loader.load("./assets/Rigged_Character.glb", (gltf) => {
    const model = gltf.scene;
    model.scale.set(2, 2, 2);
    model.position.set(0, 0, 0);
    scene.add(model);

    model.traverse((obj) => {
      if (obj.isSkinnedMesh) {
        skeleton = obj.skeleton;
        console.log("Skeleton encontrado:");
        skeleton.bones.forEach(b => console.log(b.name));
        if (SHOW_BONE_HELPERS) addHelpersToBones();
      }
    });
  }, undefined, (err) => {
    console.error("Error cargando GLTF:", err);
  });

  /* WEBSOCKET */
  socket = new WebSocket("ws://localhost:8000");

  socket.onopen = () => {
    console.log("WebSocket conectado");
  };

  socket.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      if (data.type === "pose") {
        // Soportamos dos formatos:
        // 1) data.keypoints = [ { persona_idx:0, keypoints: [[x,y],...] }, ... ]
        // 2) data.keypoints = [[x,y], [x,y], ...] (solo keypoints de 1 persona)
        latestKeypoints = data.keypoints;
        if (DEBUG) {
          // log resumido
          console.debug("WS: keypoints received, persons:", Array.isArray(latestKeypoints) ? latestKeypoints.length : "unknown");
        }
      }
    } catch (e) {
      console.warn("WS: error parseando mensaje:", e, event.data);
    }
  };

  socket.onerror = (e) => console.error("WebSocket error:", e);
  socket.onclose = (e) => console.warn("WebSocket closed:", e);

  window.addEventListener("resize", onWindowResize);

  animate();
}

/* ---------------------------------------------------------------- */
/* MAPEO YOLO → HUESOS (17 keypoints estándar) */
/* ---------------------------------------------------------------- */

const boneMap = {
  // Cabeza y cuello
  mixamorigHead: [0, 1],          // nose → left_eye (aprox. para orientación)
  mixamorigNeck: [5, 6],          // left_shoulder → right_shoulder

  // Tronco
  mixamorigSpine2: [5,6],         // hombros → dirección torso superior
  mixamorigSpine: [11,12],        // caderas → torso inferior
  mixamorigHips: [11,12],         // root = promedio de caderas

  // Brazos
  mixamorigRightShoulder: [6,8],  // right_shoulder → right_elbow
  mixamorigRightArm: [8,10],      // right_elbow → right_wrist
  mixamorigLeftShoulder: [5,7],   // left_shoulder → left_elbow
  mixamorigLeftArm: [7,9],        // left_elbow → left_wrist

  // Piernas
  mixamorigRightUpLeg: [12,14],   // right_hip → right_knee
  mixamorigRightLeg: [14,16],     // right_knee → right_ankle
  mixamorigLeftUpLeg: [11,13],    // left_hip → left_knee
  mixamorigLeftLeg: [13,15],      // left_knee → left_ankle

  // Manos (solo muñecas por ahora)
  mixamorigRightHand: [10,10],    // right_wrist
  mixamorigLeftHand: [9,9],       // left_wrist
};

/* ---------------------------------------------------------------- */
/* UTIL: normalización y extracción segura de puntos */
/* ---------------------------------------------------------------- */

function toPoint(objOrArr) {
  // acepta {x,y} o [x,y]
  if (!objOrArr) return null;
  if (Array.isArray(objOrArr)) {
    return { x: objOrArr[0], y: objOrArr[1] };
  }
  if (typeof objOrArr === "object" && ("x" in objOrArr || "0" in objOrArr)) {
    return { x: objOrArr.x ?? objOrArr[0], y: objOrArr.y ?? objOrArr[1] };
  }
  return null;
}

function normalizePoint(p) {
  // p = {x,y} en px
  return {
    x: (p.x / VIDEO_WIDTH) * 2 - 1,
    y: -(p.y / VIDEO_HEIGHT) * 2 + 1
  };
}

function getPersonKeypoints(raw) {
  // raw puede ser:
  // - array de personas: [{persona_idx:..., keypoints: [[x,y],...]}, ...]
  // - array de puntos directamente: [[x,y], ...]
  if (!raw) return null;
  if (Array.isArray(raw) && raw.length === 0) return null;

  // caso: array de personas con keypoints
  if (Array.isArray(raw) && raw[0] && raw[0].keypoints) {
    // tomamos persona 0 por simplicidad (puedes cambiar la lógica)
    return raw[0].keypoints;
  }

  // caso: ya es array de puntos
  if (Array.isArray(raw) && Array.isArray(raw[0]) && raw[0].length >= 2) {
    return raw;
  }

  // caso inesperado
  return null;
}

/* ---------------------------------------------------------------- */
/* ACTUALIZAR ESQUELETO (mejorada + debug) */
/* ---------------------------------------------------------------- */

function updateSkeleton(rawKpts) {
  if (!skeleton) return;

  const kpts = getPersonKeypoints(rawKpts);
  if (!kpts) {
    if (DEBUG) console.debug("No hay keypoints válidos en este frame");
    return;
  }

  // root como promedio de las caderas (11:left_hip, 12:right_hip)
  const hipL = toPoint(kpts[11]);
  const hipR = toPoint(kpts[12]);
  if (!hipL && !hipR) return;
  const rootPx = {
    x: ( (hipL ? hipL.x : 0) + (hipR ? hipR.x : 0) ) / ( (hipL?1:0) + (hipR?1:0) ),
    y: ( (hipL ? hipL.y : 0) + (hipR ? hipR.y : 0) ) / ( (hipL?1:0) + (hipR?1:0) )
  };
  const rootPoint = normalizePoint(rootPx);

  // Loop de huesos
  for (const boneName in boneMap) {
    const bone = skeleton.getBoneByName(boneName);
    if (!bone) {
      if (DEBUG && frameCounter % DEBUG_EVERY_N_FRAMES === 0) console.debug(`Bone no encontrado en skeleton: ${boneName}`);
      continue;
    }

    const [a, b] = boneMap[boneName];
    const pa = toPoint(kpts[a]);
    const pb = toPoint(kpts[b]);
    if (!pa || !pb) {
      // si faltan puntos, ignoramos
      if (DEBUG && frameCounter % DEBUG_EVERY_N_FRAMES === 0) console.debug(`Keypoints faltantes para ${boneName}: indices ${a}, ${b}`);
      continue;
    }

    const np1 = normalizePoint(pa);
    const np2 = normalizePoint(pb);

    // Vector relativo al root
    const dx = (np2.x - rootPoint.x) - (np1.x - rootPoint.x);
    const dy = (np2.y - rootPoint.y) - (np1.y - rootPoint.y);

    const targetAngle = Math.atan2(dy, dx);

    // Interpolación suave
    bone.rotation.z = THREE.MathUtils.lerp(bone.rotation.z, -targetAngle, 0.12);

    // debug por hueso (throttled)
    if (DEBUG && frameCounter % DEBUG_EVERY_N_FRAMES === 0) {
      console.debug(`Bone ${boneName}: idx [${a},${b}] np1(${np1.x.toFixed(2)},${np1.y.toFixed(2)}) np2(${np2.x.toFixed(2)},${np2.y.toFixed(2)}) angle=${(-targetAngle).toFixed(2)}`);
    }
  }

  // Profundidad del torso: usamos hombros correctos (5:left_shoulder, 6:right_shoulder)
  const sL = toPoint(kpts[5]);
  const sR = toPoint(kpts[6]);
  if (sL && sR) {
    const shoulderL = normalizePoint(sL);
    const shoulderR = normalizePoint(sR);
    const shoulderWidth = Math.abs(shoulderL.x - shoulderR.x) || 0.0001; // evitar div/0

    const targetZ = THREE.MathUtils.clamp(1 / shoulderWidth, 0.6, 1.6);

    const spine = skeleton.getBoneByName("mixamorigSpine");
    if (spine) {
      spine.scale.lerp(new THREE.Vector3(1, 1, targetZ), 0.1);
    }

    if (DEBUG && frameCounter % DEBUG_EVERY_N_FRAMES === 0) {
      console.debug(`root(${rootPoint.x.toFixed(2)},${rootPoint.y.toFixed(2)}) shoulderWidth=${shoulderWidth.toFixed(3)} targetZ=${targetZ.toFixed(2)}`);
    }
  }
}

/* ---------------------------------------------------------------- */
/* Helpers visuales para debug (opcional) */
/* ---------------------------------------------------------------- */

function addHelpersToBones() {
  if (!skeleton) return;
  skeleton.bones.forEach(bone => {
    const helper = new THREE.AxesHelper(0.5);
    bone.add(helper);
  });
}

/* ---------------------------------------------------------------- */
/* ANIMACIÓN */
/* ---------------------------------------------------------------- */

function animate() {
  requestAnimationFrame(animate);
  frameCounter++;

  if (latestKeypoints && skeleton) {
    updateSkeleton(latestKeypoints);
  }

  renderer.render(scene, camera);
}

/* ---------------------------------------------------------------- */
/* RESIZE */
/* ---------------------------------------------------------------- */

function onWindowResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}

/* ---------------------------------------------------------------- */
/* ARRANQUE */
/* ---------------------------------------------------------------- */

init();
