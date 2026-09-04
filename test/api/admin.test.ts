import request from "supertest";
import { describe, expect, it } from "vitest";
import {
  ADMIN_AUTH,
  ADMIN_EMAIL,
  ADMIN_FIXTURE,
  ADMIN_ID_TOKEN,
  ADMIN_UID,
  USER_AUTH,
  USER_FIXTURE,
  createTestApp,
} from "../helpers/createTestApp";
import { MODEL_FALLBACK_LADDER, PRIMARY_MODEL } from "../../src/server/lib/gemini";

/** Every admin route, so the guard is asserted uniformly across all of them. */
const ADMIN_ROUTES = [
  { method: "get" as const, path: "/api/admin/metrics" },
  { method: "get" as const, path: "/api/admin/audit-logs" },
  { method: "post" as const, path: "/api/admin/set-role" },
  { method: "post" as const, path: "/api/admin/test-rbac" },
];

const DENIED = { error: "Access denied: Admin privileges required." };

/** An unsigned JWT, as an attacker would hand-craft one. */
function unsignedJwt(claims: Record<string, unknown>): string {
  const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
  return `eyJhbGciOiJub25lIn0.${payload}.signature`;
}

describe("admin authorization — the guard", () => {
  it("grants an admin presenting a verified ID token", async () => {
    const { app } = createTestApp(ADMIN_FIXTURE);
    for (const route of ADMIN_ROUTES) {
      await request(app)[route.method](route.path).set(ADMIN_AUTH).expect(200);
    }
  });

  it("denies an anonymous caller on every route", async () => {
    const { app } = createTestApp(ADMIN_FIXTURE);
    for (const route of ADMIN_ROUTES) {
      const res = await request(app)[route.method](route.path).expect(403);
      expect(res.body, route.path).toEqual(DENIED);
    }
  });

  it("denies a verified user whose Firestore role is not admin", async () => {
    const { app } = createTestApp({ ...ADMIN_FIXTURE, ...USER_FIXTURE });
    for (const route of ADMIN_ROUTES) {
      await request(app)[route.method](route.path).set(USER_AUTH).expect(403);
    }
  });

  it("denies a caller with no Firestore user document at all", async () => {
    const { app } = createTestApp({
      validTokens: { "orphan-token": { uid: "no-doc-uid", email: "nobody@example.com" } },
      userRoles: {},
    });
    await request(app)
      .get("/api/admin/metrics")
      .set("Authorization", "Bearer orphan-token")
      .expect(403);
  });

  it("grants when the role is predefined in Firestore, which is the intended path", async () => {
    const { app } = createTestApp({
      validTokens: { tok: { uid: "seeded-uid", email: "seeded@example.com" } },
      userRoles: { "seeded-uid": "admin" },
    });
    await request(app).get("/api/admin/metrics").set("Authorization", "Bearer tok").expect(200);
  });
});

describe("admin authorization — closed escalation paths", () => {
  it("ignores x-admin-role, x-admin-email and x-user-email", async () => {
    // Each of these previously granted full admin on a public service.
    const { app } = createTestApp(ADMIN_FIXTURE);
    for (const headers of [
      { "x-admin-role": "admin" },
      { "x-admin-email": "fadlysyah96@gmail.com" },
      { "x-user-email": "fadlysyah96@gmail.com" },
      { "x-admin-role": "admin", "x-user-email": "fadlysyah96@gmail.com" },
    ]) {
      const res = await request(app).get("/api/admin/metrics").set(headers).expect(403);
      expect(res.body, JSON.stringify(headers)).toEqual(DENIED);
    }
  });

  it("no longer accepts the old shared static token", async () => {
    const { app } = createTestApp(ADMIN_FIXTURE);
    await request(app)
      .get("/api/admin/metrics")
      .set("Authorization", "Bearer admin-session-token")
      .expect(403);
  });

  it("rejects an unsigned JWT that merely claims to be an admin", async () => {
    const { app } = createTestApp(ADMIN_FIXTURE);
    for (const claims of [
      { admin: true },
      { role: "admin" },
      { email: "fadlysyah96@gmail.com", admin: true },
      { uid: ADMIN_UID, admin: true },
    ]) {
      await request(app)
        .get("/api/admin/metrics")
        .set("Authorization", `Bearer ${unsignedJwt(claims)}`)
        .expect(403);
    }
  });

  it("does not privilege any email address on its own", async () => {
    // A verified token for the owner's address is still only a user unless the
    // Firestore document says admin.
    const { app } = createTestApp({
      validTokens: { tok: { uid: "owner-uid", email: "fadlysyah96@gmail.com" } },
      userRoles: { "owner-uid": "user" },
    });
    await request(app).get("/api/admin/metrics").set("Authorization", "Bearer tok").expect(403);
  });

  it("looks the role up by the token's uid, not by anything the caller sends", async () => {
    const { app } = createTestApp({
      validTokens: { "user-token": { uid: "plain-uid", email: "user@example.com" } },
      userRoles: { "plain-uid": "user", "admin-uid": "admin" },
    });
    // Naming the admin uid in a header must not help.
    await request(app)
      .get("/api/admin/metrics")
      .set("Authorization", "Bearer user-token")
      .set("x-user-id", "admin-uid")
      .set("x-admin-email", "owner@example.com")
      .expect(403);
  });

  it("denies when the token verifier is unavailable, rather than failing open", async () => {
    const { app } = createTestApp({ ...ADMIN_FIXTURE, verifierThrows: true });
    await request(app).get("/api/admin/metrics").set(ADMIN_AUTH).expect(403);
  });

  it("denies when Firestore is unreachable and there is no custom claim", async () => {
    const { app } = createTestApp({ ...ADMIN_FIXTURE, roleLookupThrows: true });
    await request(app).get("/api/admin/metrics").set(ADMIN_AUTH).expect(403);
  });

  it("returns only an error field, leaking no telemetry, when denied", async () => {
    const { app } = createTestApp(ADMIN_FIXTURE);
    const res = await request(app).get("/api/admin/metrics").expect(403);
    expect(Object.keys(res.body)).toEqual(["error"]);
  });

  it("gives the same message whether the token is absent, forged, or non-admin", async () => {
    const { app } = createTestApp({ ...ADMIN_FIXTURE, ...USER_FIXTURE });
    const bodies = [];
    for (const headers of [{}, { Authorization: "Bearer forged" }, USER_AUTH]) {
      const res = await request(app).get("/api/admin/metrics").set(headers).expect(403);
      bodies.push(res.body);
    }
    // A distinguishable message would tell an attacker which uids exist.
    expect(bodies[0]).toEqual(bodies[1]);
    expect(bodies[1]).toEqual(bodies[2]);
  });
});

describe("insecure development bypass", () => {
  it("is off by default", async () => {
    const { app } = createTestApp({ env: {} });
    await request(app).get("/api/admin/metrics").set("x-admin-role", "admin").expect(403);
  });

  it("is honoured when ALLOW_INSECURE_ADMIN=1 outside production", async () => {
    const { app } = createTestApp({ env: { ALLOW_INSECURE_ADMIN: "1" } });
    await request(app).get("/api/admin/metrics").set("x-admin-role", "admin").expect(200);
  });

  it("is refused in production even when the flag is set", async () => {
    const { app } = createTestApp({
      env: { ALLOW_INSECURE_ADMIN: "1", NODE_ENV: "production" },
    });
    await request(app).get("/api/admin/metrics").set("x-admin-role", "admin").expect(403);
  });

  it("audits a bypass grant as a warning, not a success", async () => {
    const { app, audit } = createTestApp({ env: { ALLOW_INSECURE_ADMIN: "1" } });
    await request(app).get("/api/admin/metrics").set("x-admin-role", "admin").expect(200);
    expect(audit.list()[0]).toMatchObject({
      action: "RBAC_ACCESS_GRANTED",
      actor: "insecure-dev-bypass",
      status: "warn",
    });
  });
});

describe("GET /api/admin/metrics", () => {
  it("reports the live model ladder and security posture", async () => {
    const { app } = createTestApp(ADMIN_FIXTURE);
    const res = await request(app).get("/api/admin/metrics").set(ADMIN_AUTH).expect(200);
    expect(res.body.geminiModelLadder).toEqual([...MODEL_FALLBACK_LADDER]);
    expect(res.body.primaryModel).toBe(PRIMARY_MODEL);
    expect(res.body).toMatchObject({
      securityRulesEnforced: true,
      rbacEngine: "firebase-id-token + firestore-role",
      databaseStatus: "connected",
    });
    expect(typeof res.body.systemUptimeSeconds).toBe("number");
  });
});

describe("GET /api/admin/audit-logs", () => {
  it("returns the seeded startup trail with a matching total", async () => {
    const { app } = createTestApp(ADMIN_FIXTURE);
    const res = await request(app).get("/api/admin/audit-logs").set(ADMIN_AUTH).expect(200);
    expect(res.body.total).toBe(res.body.logs.length);
    expect(res.body.logs.map((l: any) => l.action)).toContain("SYSTEM_INITIALIZED");
  });

  it("records each grant against the verified email and names the grant source", async () => {
    const { app, audit } = createTestApp(ADMIN_FIXTURE);
    await request(app).get("/api/admin/metrics").set(ADMIN_AUTH).expect(200);
    expect(audit.list()[0]).toMatchObject({
      action: "RBAC_ACCESS_GRANTED",
      actor: ADMIN_EMAIL,
      status: "success",
    });
    expect(audit.list()[0].details).toContain("firestore-role");
  });

  it("records each denial as a warning naming the route", async () => {
    const { app, audit } = createTestApp(ADMIN_FIXTURE);
    await request(app).post("/api/admin/set-role").expect(403);
    expect(audit.list()[0]).toMatchObject({
      action: "RBAC_ACCESS_DENIED",
      actor: "unauthorized_caller",
      status: "warn",
    });
    expect(audit.list()[0].details).toContain("/api/admin/set-role");
  });

  it("never writes the presented token into the audit trail", async () => {
    const { app, audit } = createTestApp(ADMIN_FIXTURE);
    await request(app).get("/api/admin/metrics").set(ADMIN_AUTH).expect(200);
    expect(JSON.stringify(audit.list())).not.toContain(ADMIN_ID_TOKEN);
  });
});

describe("POST /api/admin/set-role", () => {
  it("normalizes any non-admin role value to 'user'", async () => {
    const { app } = createTestApp(ADMIN_FIXTURE);
    for (const role of ["user", "superadmin", "Admin", "", null, 42, undefined]) {
      const res = await request(app)
        .post("/api/admin/set-role")
        .set(ADMIN_AUTH)
        .send({ targetUid: "uid-1", role })
        .expect(200);
      expect(res.body.role, String(role)).toBe("user");
    }
  });

  it("accepts an exact 'admin' role", async () => {
    const { app } = createTestApp(ADMIN_FIXTURE);
    const res = await request(app)
      .post("/api/admin/set-role")
      .set(ADMIN_AUTH)
      .send({ targetUid: "uid-1", role: "admin" })
      .expect(200);
    expect(res.body).toMatchObject({ success: true, targetUid: "uid-1", role: "admin" });
  });

  it("defaults a missing targetUid", async () => {
    const { app } = createTestApp(ADMIN_FIXTURE);
    const res = await request(app)
      .post("/api/admin/set-role")
      .set(ADMIN_AUTH)
      .send({})
      .expect(200);
    expect(res.body.targetUid).toBe("current-user");
  });

  it("audits the change against the acting admin's verified uid", async () => {
    const { app, audit } = createTestApp(ADMIN_FIXTURE);
    await request(app)
      .post("/api/admin/set-role")
      .set(ADMIN_AUTH)
      .send({ targetUid: "uid-9", role: "admin" })
      .expect(200);
    expect(audit.list()[0]).toMatchObject({ action: "ROLE_UPDATED", actor: ADMIN_UID });
    expect(audit.list()[0].details).toBe("Set role for uid-9 to admin");
  });
});

describe("POST /api/admin/test-rbac", () => {
  it("echoes the verified admin identity", async () => {
    const { app } = createTestApp(ADMIN_FIXTURE);
    const res = await request(app).post("/api/admin/test-rbac").set(ADMIN_AUTH).expect(200);
    expect(res.body).toMatchObject({ authorized: true });
    expect(res.body.user).toMatchObject({ role: "admin", uid: ADMIN_UID, email: ADMIN_EMAIL });
  });
});
