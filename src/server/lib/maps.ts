/**
 * Geocoding helpers: URL construction, response normalization, and the
 * deterministic offline fallback used when MAPS_API_KEY is absent.
 */

import type { EntryLocation } from "../../types";

export const GEOCODE_ENDPOINT = "https://maps.googleapis.com/maps/api/geocode/json";
export const MAX_ADDRESS_LENGTH = 250;

export function buildGeocodeUrl(address: string, apiKey: string): string {
  return `${GEOCODE_ENDPOINT}?address=${encodeURIComponent(address)}&key=${apiKey}`;
}

export function buildReverseGeocodeUrl(lat: number, lng: number, apiKey: string): string {
  return `${GEOCODE_ENDPOINT}?latlng=${lat},${lng}&key=${apiKey}`;
}

/** Shape of the fields this server reads from a Maps geocode response. */
export interface GoogleGeocodeResponse {
  status?: string;
  results?: Array<{
    formatted_address?: string;
    place_id?: string;
    geometry?: { location?: { lat?: number; lng?: number } };
  }>;
}

/** Returns null when the response is not a usable OK result. */
export function parseGeocodeResponse(data: GoogleGeocodeResponse | null): EntryLocation | null {
  if (!data || data.status !== "OK") return null;
  const top = data.results?.[0];
  const lat = top?.geometry?.location?.lat;
  const lng = top?.geometry?.location?.lng;
  if (typeof lat !== "number" || typeof lng !== "number") return null;

  return {
    latitude: lat,
    longitude: lng,
    formattedAddress: top?.formatted_address,
    placeId: top?.place_id,
  };
}

/**
 * Deterministic city lookup for prototyping and preview environments where no
 * Maps key is provisioned.
 */
export const FALLBACK_LOCATIONS: Record<string, { lat: number; lng: number; address: string }> = {
  jakarta: {
    lat: -6.2088,
    lng: 106.8456,
    address: "Jakarta, Special Capital Region of Jakarta, Indonesia",
  },
  "kuala lumpur": {
    lat: 3.139,
    lng: 101.6869,
    address: "Kuala Lumpur, Federal Territory of Kuala Lumpur, Malaysia",
  },
  singapore: { lat: 1.3521, lng: 103.8198, address: "Singapore, Republic of Singapore" },
  tokyo: { lat: 35.6762, lng: 139.6503, address: "Tokyo, Japan" },
  london: { lat: 51.5074, lng: -0.1278, address: "London, England, United Kingdom" },
  "new york": { lat: 40.7128, lng: -74.006, address: "New York, NY, USA" },
  "san francisco": { lat: 37.7749, lng: -122.4194, address: "San Francisco, CA, USA" },
  sydney: { lat: -33.8688, lng: 151.2093, address: "Sydney, NSW, Australia" },
  paris: { lat: 48.8566, lng: 2.3522, address: "Paris, France" },
};

/** Last-resort coordinates when no fallback city matches. */
export const DEFAULT_FALLBACK_COORDS = { lat: 3.139, lng: 101.6869 } as const;

/** Substring city match, case-insensitive; null when nothing matches. */
export function lookupFallbackLocation(query: string): EntryLocation | null {
  const queryLower = query.toLowerCase();
  for (const [key, val] of Object.entries(FALLBACK_LOCATIONS)) {
    if (queryLower.includes(key)) {
      return {
        latitude: val.lat,
        longitude: val.lng,
        formattedAddress: val.address,
        placeId: `place-${key.replace(/\s+/g, "-")}`,
      };
    }
  }
  return null;
}

/** Human-readable DMS-ish label, e.g. `3.1390°N, 101.6869°E`. */
export function formatCoordinateLabel(lat: number, lng: number): string {
  const latStr = `${Math.abs(lat).toFixed(4)}°${lat >= 0 ? "N" : "S"}`;
  const lngStr = `${Math.abs(lng).toFixed(4)}°${lng >= 0 ? "E" : "W"}`;
  return `${latStr}, ${lngStr}`;
}

export function buildPinnedLocation(lat: number, lng: number, now: number): EntryLocation {
  return {
    latitude: lat,
    longitude: lng,
    formattedAddress: `Pinned Spot (${formatCoordinateLabel(lat, lng)})`,
    placeId: `pin-${now}`,
  };
}
