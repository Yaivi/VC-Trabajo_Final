# server.py
import asyncio
import websockets

connected_clients = set()

async def handler(websocket, path):
    # Se añade un cliente al conectarse
    connected_clients.add(websocket)
    print("Cliente conectado")

    try:
        async for message in websocket:
            # El servidor no procesa mensajes de clientes
            pass
    except websockets.exceptions.ConnectionClosed:
        pass
    finally:
        # Se elimina cuando se desconecta
        connected_clients.remove(websocket)
        print("Cliente desconectado")

async def send_to_clients(message: str):
    """Envía datos a todos los clientes conectados."""
    if connected_clients:
        await asyncio.wait([ws.send(message) for ws in connected_clients])

async def start_server():
    print("Servidor WebSocket iniciado en ws://localhost:8000")
    async with websockets.serve(handler, "localhost", 8000):
        await asyncio.Future()  # Mantiene el servidor en ejecución

# Permite ejecutar el servidor directamente con `python server.py`
if __name__ == "__main__":
    asyncio.run(start_server())
