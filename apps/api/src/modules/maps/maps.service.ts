import { Injectable } from "@nestjs/common";
import type { GeoPoint } from "@privateride/validation";
import { loadEnv } from "../../config/env";

export interface RouteResult {
  distanceM: number;
  durationS: number;
}

/**
 * Routing abstraction. The stub provider estimates road distance as
 * haversine x 1.35 at an urban average of 25 km/h; Google/Mapbox adapters
 * plug in behind the same interface when credentials are configured.
 */
@Injectable()
export class MapsService {
  async route(from: GeoPoint, to: GeoPoint): Promise<RouteResult> {
    const provider = loadEnv().MAPS_PROVIDER;
    if (provider !== "stub") {
      // Google/Mapbox integration lands with M4; fail loudly rather than
      // silently returning stub values under a real-provider configuration.
      throw new Error(`Maps provider '${provider}' is not implemented yet`);
    }
    const crow = haversineMeters(from, to);
    const distanceM = Math.round(crow * 1.35);
    const durationS = Math.max(60, Math.round(distanceM / (25_000 / 3600)));
    return { distanceM, durationS };
  }
}

export function haversineMeters(a: GeoPoint, b: GeoPoint): number {
  const R = 6_371_000;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const la1 = (a.lat * Math.PI) / 180;
  const la2 = (b.lat * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
