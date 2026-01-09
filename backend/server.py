import asyncio
import websockets
import json

connected_clients = set()

async def handler(websocket):
    connected_clients.add(websocket)
    print(f"Nuevo cliente conectado: {websocket.remote_address}")

    try:
        async for message in websocket:
            try:
                if len(connected_clients) > 1:
                    await send_to_clients(message, websocket)
                
            except Exception as e:
                print(f"Error procesando mensaje: {e}")

    except websockets.exceptions.ConnectionClosedOK:
        print("Cliente desconectado normalmente.")
    except websockets.exceptions.ConnectionClosedError:
        print("Cliente desconectado con error (posiblemente cierre forzado).")
    except Exception as e:
        print(f"Error en la conexión: {e}")
    finally:
        connected_clients.discard(websocket)
        print(f"Cliente eliminado. Total conectados: {len(connected_clients)}")

async def send_to_clients(message: str, sender_ws):
    """Reenvía datos a todos los clientes MENOS al que envió el mensaje."""
    if connected_clients:
        for ws in connected_clients.copy():
            if ws != sender_ws:
                try:
                    await ws.send(message)
                except websockets.exceptions.ConnectionClosed:
                    connected_clients.discard(ws)

async def start_server():
    print("Servidor WebSocket escuchando en ws://localhost:8000")
    async with websockets.serve(handler, "localhost", 8000, ping_interval=None):
        await asyncio.Future()

if __name__ == "__main__":
    try:
        asyncio.run(start_server())
    except KeyboardInterrupt:
        print("\nServidor detenido.")