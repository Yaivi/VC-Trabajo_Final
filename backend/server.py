import asyncio
import websockets
import json

connected_clients = set()

async def handler(websocket, path):
    # Se añade un cliente al conectarse
    connected_clients.add(websocket)
    print("Cliente conectado")

    try:
        # Recibir mensajes de clientes (como el backend)
        async for message in websocket:
            print(f"Mensaje recibido del cliente: {message}") 
            try:
                data = json.loads(message)
                
                if "keypoints" in data:
                    print(f"Recibidos keypoints: {data['keypoints']}")
                else:
                    print("No se recibieron keypoints.")

                # Reenviar los datos a todos los clientes conectados
                await send_to_clients(message)
                print("Mensaje reenviado a todos los clientes")
            except json.JSONDecodeError as e:
                print(f"Error al decodificar el mensaje JSON: {e}")

    except websockets.exceptions.ConnectionClosed as e:
        print(f"Conexión cerrada: {e}")
    finally:
        # Se elimina cuando el cliente se desconecta
        connected_clients.remove(websocket)
        print("Cliente desconectado")

async def send_to_clients(message: str):
    """Envía datos a todos los clientes conectados."""
    if connected_clients:
        for ws in connected_clients:
            try:
                await ws.send(message)
            except websockets.exceptions.ConnectionClosed:
                # El cliente ha cerrado la conexión, lo eliminamos de la lista
                connected_clients.remove(ws)
                print(f"Cliente desconectado y eliminado: {ws.remote_address}")

async def start_server():
    print("Servidor WebSocket iniciado en ws://localhost:8000")
    async with websockets.serve(handler, "localhost", 8000):
        await asyncio.Future()  # Mantiene el servidor en ejecución

# Permite ejecutar el servidor directamente con `python server.py`
if __name__ == "__main__":
    asyncio.run(start_server())
