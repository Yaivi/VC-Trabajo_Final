# VC-Trabajo_Final
Proyecto final de la asignatura de Visión por Computador

Este proyecto se divide en varios componentes:

- backend
    - main.py
    - server.py
- frontend
    - index.html
    - main.js

Para el backend usamos un script de python para la captura de movimientos junto al modelo de YOLOV8N-POSE enviando los datos a un websocket y usamos otro script de python para manejar la conexión al websocket.

Los datos enviados al websocket desde el YOLO deben superar la confianza de un 0.5, estos se agrupan en una lista de puntos clave, una vez conocidos estos puntos se escribe un JSON y se envia a la ruta del websocket.

El server.py se encarga de controlar y manejar los errores y conexiones entrantes al websocket.

Para ejecutar este proyecto usar los siguiente comandos desde la ruta base:

    python /backend/server.py
    python /backend/main.py
    cd /frontend
    python -m http.server 3000