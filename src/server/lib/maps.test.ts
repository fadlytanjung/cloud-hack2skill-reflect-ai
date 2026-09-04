import { describe, expect, it } from "vitest";
import {
  DEFAULT_FALLBACK_COORDS,
  FALLBACK_LOCATIONS,
  GEOCODE_ENDPOINT,
  buildGeocodeUrl,
  buildPinnedLocation,
  buildReverseGeocodeUrl,
  formatCoordinateLabel,
  lookupFallbackLocation,
  parseGeocodeResponse,
} from "./maps";
import { validateCoordinates } from "./security";

describe("buildGeocodeUrl", () => {
  it("percent-encodes the address so it cannot inject query parameters", () => {
    const url = buildGeocodeUrl("Jakarta & Bali?key=stolen", "my-key");
    expect(url.startsWith(`${GEOCODE_ENDPOINT}?address=`)).toBe(true);
    expect(url).toContain("Jakarta%20%26%20Bali%3Fkey%3Dstolen");
    // Exactly one key parameter: the injected one did not survive encoding.
    expect(url.match(/[?&]key=/g)).toHaveLength(1);
    expect(new URL(url).searchParams.get("key")).toBe("my-key");
  });

  it("round-trips the address through URL parsing", () => {
    const address = "1600 Amphitheatre Pkwy, Mountain View, CA";
    expect(new URL(buildGeocodeUrl(address, "k")).searchParams.get("address")).toBe(address);
  });
});

describe("buildReverseGeocodeUrl", () => {
  it("formats latlng as a comma-joined pair", () => {
    const url = buildReverseGeocodeUrl(-6.2088, 106.8456, "k");
    expect(new URL(url).searchParams.get("latlng")).toBe("-6.2088,106.8456");
    expect(new URL(url).searchParams.get("key")).toBe("k");
  });
});

describe("parseGeocodeResponse", () => {
  const ok = {
    status: "OK",
    results: [
      {
        formatted_address: "Jakarta, Indonesia",
        place_id: "ChIJ123",
        geometry: { location: { lat: -6.2088, lng: 106.8456 } },
      },
    ],
  };

  it("normalizes the first result", () => {
    expect(parseGeocodeResponse(ok)).toEqual({
      latitude: -6.2088,
      longitude: 106.8456,
      formattedAddress: "Jakarta, Indonesia",
      placeId: "ChIJ123",
    });
  });

  it("returns null for every non-OK or structurally incomplete response", () => {
    for (const response of [
      null,
      {},
      { status: "ZERO_RESULTS", results: [] },
      { status: "OVER_QUERY_LIMIT" },
      { status: "REQUEST_DENIED", results: [ok.results[0]] },
      { status: "OK", results: [] },
      { status: "OK", results: [{}] },
      { status: "OK", results: [{ geometry: {} }] },
      { status: "OK", results: [{ geometry: { location: { lat: -6.2 } } }] },
      { status: "OK", results: [{ geometry: { location: { lat: "-6.2", lng: "106" } } }] },
    ]) {
      expect(parseGeocodeResponse(response as any), JSON.stringify(response)).toBeNull();
    }
  });
});

describe("lookupFallbackLocation", () => {
  it("matches a known city case-insensitively, including inside a longer query", () => {
    expect(lookupFallbackLocation("JAKARTA")?.formattedAddress).toContain("Jakarta");
    expect(lookupFallbackLocation("a cafe in Kuala Lumpur")?.formattedAddress).toContain(
      "Kuala Lumpur"
    );
  });

  it("returns a stable slugged placeId", () => {
    expect(lookupFallbackLocation("kuala lumpur")?.placeId).toBe("place-kuala-lumpur");
    expect(lookupFallbackLocation("san francisco")?.placeId).toBe("place-san-francisco");
  });

  it("returns null when nothing matches", () => {
    for (const query of ["", "Atlantis", "zzzz"]) {
      expect(lookupFallbackLocation(query), query).toBeNull();
    }
  });

  it("only contains coordinates that pass the coordinate guard", () => {
    for (const [city, val] of Object.entries(FALLBACK_LOCATIONS)) {
      expect(validateCoordinates(val.lat, val.lng).valid, city).toBe(true);
    }
    expect(
      validateCoordinates(DEFAULT_FALLBACK_COORDS.lat, DEFAULT_FALLBACK_COORDS.lng).valid
    ).toBe(true);
  });
});

describe("formatCoordinateLabel", () => {
  it("marks each hemisphere correctly to four decimals", () => {
    expect(formatCoordinateLabel(3.139, 101.6869)).toBe("3.1390°N, 101.6869°E");
    expect(formatCoordinateLabel(-33.8688, 151.2093)).toBe("33.8688°S, 151.2093°E");
    expect(formatCoordinateLabel(40.7128, -74.006)).toBe("40.7128°N, 74.0060°W");
    expect(formatCoordinateLabel(-6.2088, -80.5)).toBe("6.2088°S, 80.5000°W");
  });

  it("treats the zero meridian and equator as N/E", () => {
    expect(formatCoordinateLabel(0, 0)).toBe("0.0000°N, 0.0000°E");
  });
});

describe("buildPinnedLocation", () => {
  it("echoes the caller's coordinates with a readable label and timestamped id", () => {
    expect(buildPinnedLocation(1.3521, 103.8198, 1700000000000)).toEqual({
      latitude: 1.3521,
      longitude: 103.8198,
      formattedAddress: "Pinned Spot (1.3521°N, 103.8198°E)",
      placeId: "pin-1700000000000",
    });
  });
});
