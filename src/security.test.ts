import { describe, it, expect } from "vitest";
import { sanitizeForFirestore } from "./lib/firebase";
import { firebaseConfig } from "./lib/firebaseConfig";

describe("Security & Payload Sanitization Verification", () => {
  it("should strip undefined properties from database payloads", () => {
    const rawPayload = {
      title: "Morning Walk",
      content: "Reflected on goals",
      location: {
        latitude: 37.7749,
        longitude: -122.4194,
        placeId: undefined,
      },
      tags: undefined,
      mood: "calm",
    };

    const sanitized = sanitizeForFirestore(rawPayload);

    expect(sanitized).toBeDefined();
    expect(sanitized.title).toBe("Morning Walk");
    expect(sanitized.mood).toBe("calm");
    expect(sanitized.location.latitude).toBe(37.7749);
    expect("placeId" in sanitized.location).toBe(false);
    expect("tags" in sanitized).toBe(false);
  });

  it("should validate geographic coordinates boundaries", () => {
    const isValidCoord = (lat: number, lng: number) => {
      return lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
    };

    expect(isValidCoord(37.7749, -122.4194)).toBe(true);
    expect(isValidCoord(90, 180)).toBe(true);
    expect(isValidCoord(-90, -180)).toBe(true);
    expect(isValidCoord(91, 0)).toBe(false);
    expect(isValidCoord(-91, 0)).toBe(false);
    expect(isValidCoord(0, 181)).toBe(false);
    expect(isValidCoord(0, -181)).toBe(false);
  });

  it("should initialize firebaseConfig directly from environment variables", () => {
    expect(firebaseConfig).toBeDefined();
    expect(firebaseConfig.firestoreDatabaseId).toBe("reflect-ai-app");
    expect(typeof firebaseConfig.apiKey).toBe("string");
    expect(typeof firebaseConfig.projectId).toBe("string");
  });
});
