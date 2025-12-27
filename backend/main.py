import cv2
import asyncio
import websockets
import json
from ultralytics import YOLO

async def send_keypoints(websocket, keypoints):
    message = json.dumps({"keypoints": keypoints})
    await websocket.send(message)

async def start_websocket():
    #Inicia la conexión WebSocket y la mantiene abierta.
    uri = "ws://localhost:8000"
    websocket = await websockets.connect(uri)
    print("Conexión WebSocket establecida.")
    return websocket

async def capturar_poses():
    model = YOLO('yolov8n-pose.pt')

    cap = cv2.VideoCapture(0)

    if not cap.isOpened():
        print("No se pudo abrir la cámara.")
        return

    print("Presiona 'q' para salir.")

    websocket = await start_websocket()  # Mantener la conexión WebSocket abierta

    while True:
        success, frame = cap.read()
        if not success:
            break

        results = model(frame, conf=0.5)

        annotated_frame = results[0].plot()

        if results[0].keypoints is not None:
            keypoints = results[0].keypoints.xy.cpu().numpy()

            # Preparar los keypoints para enviar
            keypoints_list = []

            for persona_idx, persona_kpts in enumerate(keypoints):
                if len(persona_kpts) > 0:
                    keypoints_list.append({
                        "persona_idx": persona_idx,
                        "keypoints": persona_kpts.tolist()
                    })

            # Crear el mensaje que será enviado a través del WebSocket
            data = {
                "type": "pose",           # Establecemos el tipo como "pose"
                "keypoints": keypoints_list  # Agregamos los keypoints de todas las personas
            }

            # Enviar el mensaje
            await websocket.send(json.dumps(data))

            # Enviar los keypoints al servidor WebSocket de forma asíncrona
            await send_keypoints(websocket, keypoints_list)

        cv2.imshow("YOLOv8 Pose Estimation", annotated_frame)

        if cv2.waitKey(1) & 0xFF == ord('q'):
            break

    cap.release()
    cv2.destroyAllWindows()
    await websocket.close()  # Cerrar la conexión WebSocket al final

if __name__ == "__main__":
    asyncio.run(capturar_poses())
