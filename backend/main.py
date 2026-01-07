import cv2
import asyncio
import websockets
import json
import time
from ultralytics import YOLO

async def capturar_poses():
    print("🚀 Cargando modelo YOLO (Nano)...")
    model = YOLO('yolov8n-pose.pt')

    # Configurar cámara
    cap = cv2.VideoCapture(1)
    if not cap.isOpened():
        cap = cv2.VideoCapture(0)
    
    if not cap.isOpened():
        print("Error: No hay cámara.")
        return

    cap.set(cv2.CAP_PROP_FRAME_WIDTH, 640)
    cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 480)
    cap.set(cv2.CAP_PROP_FPS, 30)

    print("Cámara iniciada en modo oculto (High Performance).")
    print("Conectando al servidor...")

    uri = "ws://localhost:8000"
    
    prev_time = 0
    
    while True:
        try:
            async with websockets.connect(uri) as websocket:
                print("Conectado. Enviando datos a toda velocidad...")
                
                while True:
                    start_time = time.time()
                    
                    success, frame = cap.read()
                    if not success:
                        print("Fallo cámara")
                        break

                    results = model(frame, conf=0.5, imgsz=320, verbose=False)

                    if results[0].keypoints is not None:
                        kpts = results[0].keypoints.xy.cpu().numpy()
                        
                        keypoints_list = []
                        for idx, persona in enumerate(kpts):
                            if len(persona) > 0:
                                keypoints_list.append({
                                    "persona_idx": idx,
                                    "keypoints": persona.tolist()
                                })

                        if keypoints_list:
                            data = json.dumps({"type": "pose", "keypoints": keypoints_list})
                            await websocket.send(data)

                    curr_time = time.time()
                    fps = 1 / (curr_time - prev_time) if prev_time > 0 else 0
                    prev_time = curr_time

                    await asyncio.sleep(0.001)

        except (OSError, websockets.exceptions.ConnectionClosed):
            print("Conexión perdida o servidor apagado. Reintentando en 2s...")
            await asyncio.sleep(2)
        except KeyboardInterrupt:
            print("Saliendo...")
            break
        except Exception as e:
            print(f"Error: {e}")
            break

    cap.release()

if __name__ == "__main__":
    asyncio.run(capturar_poses())