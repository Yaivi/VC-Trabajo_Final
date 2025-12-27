import * as THREE from "./libs/three.module.js";
import { GLTFLoader } from "./libs/GLTFLoader.js";

/* ---------------------------------------------------------------- */
/* VARIABLES GLOBALES */
/* ---------------------------------------------------------------- */

let scene, camera, renderer;
let skeleton = null;
let socket = null;

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
  camera.position.set(0, 10, 20);
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
      }
    });
  });

  /* WEBSOCKET */
  socket = new WebSocket("ws://localhost:8000");

  socket.onopen = () => {
    console.log("WebSocket conectado");
  };

  socket.onmessage = (event) => {
    console.log("Keypoints enviados");
    const data = JSON.parse(event.data);
    if (data.type === "pose" && skeleton) {
      updateSkeleton(data.keypoints);
    }
  };

  window.addEventListener("resize", onWindowResize);

  animate();
}

/* ---------------------------------------------------------------- */
/* MAPEO YOLO → HUESOS */
/* ---------------------------------------------------------------- */

// Mapeo de los puntos clave a los huesos del modelo
const boneMap = {
  // Cabeza y cuello
  mixamorigHead: [0, 1],    // Cabeza -> cuello (puntos clave de la cabeza y el cuello)
  mixamorigNeck: [1, 2],    // Cuello -> hombro

  // Tronco
  mixamorigSpine2: [2, 3],  // Espina -> torso superior
  mixamorigSpine: [3, 4],   // Torso superior -> torso inferior
  mixamorigHips: [4, 5],    // Caderas -> zona pélvica
  
  // Brazos (derecho e izquierdo)
  mixamorigRightShoulder: [6, 8],  // Hombro derecho -> codo
  mixamorigRightArm: [8, 10],      // Codo derecho -> muñeca
  mixamorigLeftShoulder: [11, 13], // Hombro izquierdo -> codo
  mixamorigLeftArm: [13, 15],      // Codo izquierdo -> muñeca

  // Piernas
  mixamorigRightUpLeg: [16, 18], // Muslo derecho -> rodilla
  mixamorigRightLeg: [18, 20],   // Rodilla derecha -> tobillo
  mixamorigLeftUpLeg: [21, 23],  // Muslo izquierdo -> rodilla
  mixamorigLeftLeg: [23, 25],    // Rodilla izquierda -> tobillo

  // Manos y dedos (ajustado para los dedos)
  mixamorigRightHand: [26, 28],  // Mano derecha -> muñeca derecha
  mixamorigLeftHand: [29, 31],   // Mano izquierda -> muñeca izquierda
};


/* ---------------------------------------------------------------- */
/* ACTUALIZAR ESQUELETO */
/* ---------------------------------------------------------------- */

function updateSkeleton(kpts) {
  console.log("Actualizando hueso");
  for (const boneName in boneMap) {
    if (!skeleton) return;

    const bone = skeleton.getBoneByName(boneName);
    if (!bone) continue;

    const [a, b] = boneMap[boneName];
    const p1 = kpts[a];
    const p2 = kpts[b];
    if (!p1 || !p2) continue;

    // Convertir coordenadas normalizadas si es necesario
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    const angle = Math.atan2(dy, dx);

    // Ajuste de rotación del hueso (puedes ajustar la tasa de suavizado)
    bone.rotation.z = THREE.MathUtils.lerp(bone.rotation.z, -angle, 0.35);

    console.log(`Actualizando hueso ${boneName}: rotación Z = ${bone.rotation.z}`);
  }
}

/* ---------------------------------------------------------------- */
/* ANIMACIÓN */
/* ---------------------------------------------------------------- */

function animate() {
  requestAnimationFrame(animate);
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
