import cv2
from ultralytics import YOLO

def capturar_poses():
    model = YOLO('yolov8n-pose.pt')

    cap = cv2.VideoCapture(0)

    if not cap.isOpened():
        print("No se pudo abrir la cámara.")
        return

    print("Presiona 'q' para salir.")

    while True:
        success, frame = cap.read()
        if not success:
            break

        results = model(frame, conf=0.5)


        annotated_frame = results[0].plot()


        if results[0].keypoints is not None:
            keypoints = results[0].keypoints.xy.cpu().numpy()
            
            for persona_idx, persona_kpts in enumerate(keypoints):

                if len(persona_kpts) > 0:
                    nose_x, nose_y = persona_kpts[0]
                    pass

        cv2.imshow("YOLOv8 Pose Estimation", annotated_frame)

        if cv2.waitKey(1) & 0xFF == ord('q'):
            break

    cap.release()
    cv2.destroyAllWindows()

if __name__ == "__main__":
    capturar_poses()