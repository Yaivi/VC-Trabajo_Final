import asyncio
import threading
import webbrowser
from http.server import SimpleHTTPRequestHandler
from socketserver import TCPServer

from backend.server import start_server
from backend.main import capturar_poses

def start_http():
    class Handler(SimpleHTTPRequestHandler):
        def __init__(self, *args, **kwargs):
            super().__init__(*args, directory="frontend", **kwargs)

    with TCPServer(("localhost", 3000), Handler) as httpd:
        httpd.serve_forever()

async def main():
    asyncio.create_task(start_server())
    webbrowser.open("http://localhost:3000")
    capturar_poses()  # ← MAIN THREAD

if __name__ == "__main__":
    threading.Thread(target=start_http, daemon=True).start()
    asyncio.run(main())
