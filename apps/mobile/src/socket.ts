import { io, Socket } from "socket.io-client";
import { getAccessToken } from "./api";
import { getApiUrl, TUNNEL_HEADERS } from "./server";

let socket: Socket | null = null;

/** Lazily-connected realtime socket; reconnects with a fresh token. */
export async function getSocket(): Promise<Socket> {
  if (socket?.connected) return socket;
  const token = await getAccessToken();
  socket?.disconnect();
  socket = io(`${await getApiUrl()}/realtime`, {
    transports: ["websocket"],
    auth: { token },
    extraHeaders: { ...TUNNEL_HEADERS },
  });
  return socket;
}

export function closeSocket(): void {
  socket?.disconnect();
  socket = null;
}
