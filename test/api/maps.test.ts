import request from "supertest";
import { describe, expect, it } from "vitest";
import { createTestApp, FIXED_NOW } from "../helpers/createTestApp";
import { MAX_ADDRESS_LENGTH } from "../../src/server/lib/maps";

const MAPS_ENV = { MAPS_API_KEY: "test-maps-key" };

const OK_GEOCODE = {
  status: "OK",
  results: [
    {
      formatted_address: "Jakarta, Indonesia",
      place_id: "ChIJ-jakarta",
      geometry: { location: { lat: -6.2088, lng: 106.8456 } },
    },
  ],
};

describe("POST /api/maps/geocode", () => {
  it("resolves an address through the Maps API when a key is configured", async () => {
    const { app, fetchCalls } = createTestApp({
      env: MAPS_ENV,
      fetchResponses: [{ json: OK_GEOCODE }],
    });
    const res = await request(app)
      .post("/api/maps/geocode")
      .send({ address: "Jakarta" })
      .expect(200);
    expect(res.body.location).toEqual({
      latitude: -6.2088,
      longitude: 106.8456,
      formattedAddress: "Jakarta, Indonesia",
      placeId: "ChIJ-jakarta",
    });
    expect(fetchCalls).toHaveLength(1);
    expect(new URL(fetchCalls[0].url).searchParams.get("key")).toBe("test-maps-key");
  });

  it("audits a successful lookup", async () => {
    const { app, audit } = createTestApp({ env: MAPS_ENV, fetchResponses: [{ json: OK_GEOCODE }] });
    await request(app).post("/api/maps/geocode").send({ address: "Jakarta" }).expect(200);
    expect(audit.list()[0]).toMatchObject({ action: "GEOCODE_LOOKUP", status: "success" });
  });

  it("requires a non-empty address", async () => {
    const { app } = createTestApp();
    for (const body of [{}, { address: "" }, { address: "   " }, { address: 42 }]) {
      const res = await request(app).post("/api/maps/geocode").send(body).expect(400);
      expect(res.body.error).toMatch(/Address query is required/);
    }
  });

  it("rejects an address over the length cap", async () => {
    const { app } = createTestApp();
    const res = await request(app)
      .post("/api/maps/geocode")
      .send({ address: "x".repeat(MAX_ADDRESS_LENGTH + 1) })
      .expect(400);
    expect(res.body.error).toContain(String(MAX_ADDRESS_LENGTH));
  });

  it("strips markup from the query before it leaves the process", async () => {
    const { app, fetchCalls } = createTestApp({
      env: MAPS_ENV,
      fetchResponses: [{ json: OK_GEOCODE }],
    });
    await request(app)
      .post("/api/maps/geocode")
      .send({ address: '<img src=x onerror=alert(1)>Jakarta' })
      .expect(200);
    expect(new URL(fetchCalls[0].url).searchParams.get("address")).toBe("Jakarta");
  });

  it("uses the deterministic table when no Maps key is configured", async () => {
    const { app, fetchCalls } = createTestApp({ env: {} });
    const res = await request(app)
      .post("/api/maps/geocode")
      .send({ address: "a cafe in Kuala Lumpur" })
      .expect(200);
    expect(res.body.location.formattedAddress).toContain("Kuala Lumpur");
    expect(res.body.location.placeId).toBe("place-kuala-lumpur");
    expect(fetchCalls).toHaveLength(0);
  });

  it("falls back to the table when Maps returns ZERO_RESULTS", async () => {
    const { app } = createTestApp({
      env: MAPS_ENV,
      fetchResponses: [{ json: { status: "ZERO_RESULTS", results: [] } }],
    });
    const res = await request(app).post("/api/maps/geocode").send({ address: "Tokyo" }).expect(200);
    expect(res.body.location.formattedAddress).toBe("Tokyo, Japan");
  });

  it("falls back to the table when the Maps request itself throws", async () => {
    const { app } = createTestApp({
      env: MAPS_ENV,
      fetchResponses: [new Error("ETIMEDOUT")],
    });
    const res = await request(app).post("/api/maps/geocode").send({ address: "Paris" }).expect(200);
    expect(res.body.location.formattedAddress).toBe("Paris, France");
  });

  it("returns valid default coordinates for an unrecognised place", async () => {
    const { app } = createTestApp({ env: {} });
    const res = await request(app)
      .post("/api/maps/geocode")
      .send({ address: "Atlantis" })
      .expect(200);
    expect(res.body.location.formattedAddress).toBe("Atlantis");
    expect(res.body.location.latitude).toBeGreaterThanOrEqual(-90);
    expect(res.body.location.latitude).toBeLessThanOrEqual(90);
    expect(res.body.location.placeId).toBe(`place-custom-${FIXED_NOW}`);
  });

  it("never echoes the Maps key back to the caller", async () => {
    const { app } = createTestApp({ env: MAPS_ENV, fetchResponses: [{ json: OK_GEOCODE }] });
    const res = await request(app).post("/api/maps/geocode").send({ address: "Jakarta" });
    expect(JSON.stringify(res.body)).not.toContain("test-maps-key");
  });
});

describe("POST /api/maps/reverse-geocode", () => {
  it("labels a pinned coordinate through the Maps API", async () => {
    const { app, fetchCalls } = createTestApp({
      env: MAPS_ENV,
      fetchResponses: [{ json: OK_GEOCODE }],
    });
    const res = await request(app)
      .post("/api/maps/reverse-geocode")
      .send({ latitude: 1.3521, longitude: 103.8198 })
      .expect(200);
    // The caller's coordinates are preserved; only the label comes from Maps.
    expect(res.body.location).toEqual({
      latitude: 1.3521,
      longitude: 103.8198,
      formattedAddress: "Jakarta, Indonesia",
      placeId: "ChIJ-jakarta",
    });
    expect(new URL(fetchCalls[0].url).searchParams.get("latlng")).toBe("1.3521,103.8198");
  });

  it("rejects out-of-range coordinates with the specific reason", async () => {
    const { app, fetchCalls } = createTestApp({ env: MAPS_ENV });
    const lat = await request(app)
      .post("/api/maps/reverse-geocode")
      .send({ latitude: 91, longitude: 0 })
      .expect(400);
    expect(lat.body.error).toMatch(/Latitude/);

    const lng = await request(app)
      .post("/api/maps/reverse-geocode")
      .send({ latitude: 0, longitude: 181 })
      .expect(400);
    expect(lng.body.error).toMatch(/Longitude/);
    expect(fetchCalls).toHaveLength(0);
  });

  it("rejects missing, null and non-numeric coordinates", async () => {
    const { app } = createTestApp({ env: MAPS_ENV });
    for (const body of [
      {},
      { latitude: null, longitude: null },
      { latitude: "", longitude: "" },
      { latitude: "abc", longitude: "def" },
      { latitude: true, longitude: false },
      { latitude: 1.5 },
    ]) {
      const res = await request(app).post("/api/maps/reverse-geocode").send(body).expect(400);
      expect(res.body.error, JSON.stringify(body)).toBeTruthy();
    }
  });

  it("accepts the coordinate boundaries", async () => {
    const { app } = createTestApp({ env: {} });
    for (const [latitude, longitude] of [
      [90, 180],
      [-90, -180],
      [0, 0],
    ]) {
      await request(app)
        .post("/api/maps/reverse-geocode")
        .send({ latitude, longitude })
        .expect(200);
    }
  });

  it("produces a readable pinned label when no Maps key is configured", async () => {
    const { app, fetchCalls } = createTestApp({ env: {} });
    const res = await request(app)
      .post("/api/maps/reverse-geocode")
      .send({ latitude: -33.8688, longitude: 151.2093 })
      .expect(200);
    expect(res.body.location.formattedAddress).toBe("Pinned Spot (33.8688°S, 151.2093°E)");
    expect(res.body.location.placeId).toBe(`pin-${FIXED_NOW}`);
    expect(fetchCalls).toHaveLength(0);
  });

  it("falls back to a pinned label when the Maps request throws", async () => {
    const { app } = createTestApp({ env: MAPS_ENV, fetchResponses: [new Error("ETIMEDOUT")] });
    const res = await request(app)
      .post("/api/maps/reverse-geocode")
      .send({ latitude: 0, longitude: 0 })
      .expect(200);
    expect(res.body.location.formattedAddress).toContain("Pinned Spot");
  });

  it("coerces numeric strings from form-encoded clients", async () => {
    const { app } = createTestApp({ env: {} });
    const res = await request(app)
      .post("/api/maps/reverse-geocode")
      .type("form")
      .send({ latitude: "1.3521", longitude: "103.8198" })
      .expect(200);
    expect(res.body.location.latitude).toBe(1.3521);
  });
});
