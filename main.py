import asyncio
import webbrowser
import threading
import socket
from http.server import SimpleHTTPRequestHandler
from socketserver import TCPServer

from backend.server import start_server
from backend.main import capturar_poses

def start_http_server():
    class Handler(SimpleHTTPRequestHandler):
        def __init__(self, *args, **kwargs):
            super().__init__(*args, directory="frontend", **kwargs)

    with TCPServer(("localhost", 3000), Handler) as httpd:
        print("Frontend en http://localhost:3000")
        httpd.serve_forever()

async def wait_for_websocket(host="localhost", port=8000, timeout=10):

    start_time = asyncio.get_event_loop().time()
    while True:
        try:
            with socket.create_connection((host, port), timeout=1):
                print(f"WebSocket listo en ws://{host}:{port}")
                return
        except (ConnectionRefusedError, OSError):
            # Si el timeout se excede, lanzamos excepción
            if asyncio.get_event_loop().time() - start_time > timeout:
                raise TimeoutError(f"No se pudo conectar al WebSocket en {host}:{port}")
            await asyncio.sleep(0.1)  # Espera 100ms antes de reintentar



async def start_backend_ready():
    # Creamos la tarea del servidor WebSocket
    ws_task = asyncio.create_task(start_server())

    # Esperamos hasta que el WebSocket esté listo
    await wait_for_websocket()

    # Abrimos el navegador solo cuando el WS está escuchando
    webbrowser.open("http://localhost:3000")

    # Ejecutamos YOLO junto con el WebSocket
    await asyncio.gather(
        ws_task,
        capturar_poses()
    )

if __name__ == "__main__":
    # Servidor HTTP en hilo aparte
    threading.Thread(target=start_http_server, daemon=True).start()

    # Backend: WebSocket + YOLO
    asyncio.run(start_backend_ready())
