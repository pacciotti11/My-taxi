import { io, Socket } from "socket.io-client";
import { API_URL, getAccessToken } from "./api";

let socket: Socket | null = null;

/** Lazily-connected realtime socket; reconnects with a fresh token. */
export async function getSocket(): Promise<Socket> {
  if (socket?.connected) return socket;
  const token = await getAccessToken();
  socket?.disconnect();
  socket = io(`${API_URL}/realtime`, {
    transports: ["websocket"],
    auth: { token },
  });
  return socket;
}

export function closeSocket(): void {
  socket?.disconnect();
  socket = null;
}
