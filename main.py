import asyncio
import webbrowser
import threading
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


async def start_backend():
    await asyncio.gather(
        start_server(),    # WebSocket
        capturar_poses()   # YOLO
    )

if __name__ == "__main__":
    threading.Thread(
        target=start_http_server,
        daemon=True
    ).start()

    webbrowser.open("http://localhost:3000")

    asyncio.run(start_backend())
