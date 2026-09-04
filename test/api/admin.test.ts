import request from "supertest";
import { describe, expect, it } from "vitest";
import { ADMIN_AUTH, createTestApp } from "../helpers/createTestApp";
import { MODEL_FALLBACK_LADDER, PRIMARY_MODEL } from "../../src/server/lib/gemini";

/** Every admin route, so the guard can be asserted uniformly across all of them. */
const ADMIN_ROUTES = [
  { method: "get" as const, path: "/api/admin/metrics" },
  { method: "get" as const, path: "/api/admin/audit-logs" },
  { method: "post" as const, path: "/api/admin/set-role" },
  { method: "post" as const, path: "/api/admin/test-rbac" },
];

function jwt(claims: Record<string, unknown>): string {
  const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
  return `header.${payload}.signature`;
}

describe("admin route authorization", () => {
  it("denies every admin route to an anonymous caller", async () => {
    const { app } = createTestApp();
    for (const route of ADMIN_ROUTES) {
      const res = await request(app)[route.method](route.path).expect(403);
      expect(res.body.error, route.path).toBe("Access denied: Admin privileges required.");
    }
  });

  it("denies every admin route to a non-admin JWT", async () => {
    const { app } = createTestApp();
    for (const route of ADMIN_ROUTES) {
      await request(app)
        [route.method](route.path)
        .set("Authorization", `Bearer ${jwt({ role: "user", sub: "uid-1" })}`)
        .expect(403);
    }
  });

  it("grants every admin route to the static admin token", async () => {
    const { app } = createTestApp();
    for (const route of ADMIN_ROUTES) {
      await request(app)[route.method](route.path).set(ADMIN_AUTH).expect(200);
    }
  });

  it("grants access to a JWT carrying an admin claim", async () => {
    const { app } = createTestApp();
    await request(app)
      .post("/api/admin/test-rbac")
      .set("Authorization", `Bearer ${jwt({ admin: true, email: "ops@reflectai.cloud" })}`)
      .expect(200);
  });

  it("grants access to the x-admin-role simulation header", async () => {
    const { app } = createTestApp();
    await request(app).get("/api/admin/metrics").set("x-admin-role", "admin").expect(200);
  });

  it("leaks no metrics data in a denied response body", async () => {
    const { app } = createTestApp();
    const res = await request(app).get("/api/admin/metrics").expect(403);
    expect(Object.keys(res.body)).toEqual(["error"]);
  });
});

describe("GET /api/admin/metrics", () => {
  it("reports the live model ladder and security posture", async () => {
    const { app } = createTestApp();
    const res = await request(app).get("/api/admin/metrics").set(ADMIN_AUTH).expect(200);
    expect(res.body.geminiModelLadder).toEqual([...MODEL_FALLBACK_LADDER]);
    expect(res.body.primaryModel).toBe(PRIMARY_MODEL);
    expect(res.body).toMatchObject({
      securityRulesEnforced: true,
      rbacEngine: "active",
      databaseStatus: "connected",
    });
    expect(typeof res.body.systemUptimeSeconds).toBe("number");
  });
});

describe("GET /api/admin/audit-logs", () => {
  it("returns the seeded startup trail with a matching total", async () => {
    const { app } = createTestApp();
    const res = await request(app).get("/api/admin/audit-logs").set(ADMIN_AUTH).expect(200);
    expect(res.body.total).toBe(res.body.logs.length);
    expect(res.body.logs.map((l: any) => l.action)).toContain("SYSTEM_INITIALIZED");
  });

  it("records each granted access, newest first", async () => {
    const { app, audit } = createTestApp();
    await request(app).get("/api/admin/metrics").set(ADMIN_AUTH).expect(200);
    expect(audit.list()[0]).toMatchObject({
      action: "RBAC_ACCESS_GRANTED",
      details: "Authorized GET /api/admin/metrics",
      status: "success",
    });
  });

  it("records each denied access as a warning naming the route", async () => {
    const { app, audit } = createTestApp();
    await request(app).post("/api/admin/set-role").expect(403);
    expect(audit.list()[0]).toMatchObject({
      action: "RBAC_ACCESS_DENIED",
      actor: "unauthorized_caller",
      status: "warn",
    });
    expect(audit.list()[0].details).toContain("/api/admin/set-role");
  });
});

describe("POST /api/admin/set-role", () => {
  it("normalizes any non-admin role value to 'user'", async () => {
    const { app } = createTestApp();
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
    const { app } = createTestApp();
    const res = await request(app)
      .post("/api/admin/set-role")
      .set(ADMIN_AUTH)
      .send({ targetUid: "uid-1", role: "admin" })
      .expect(200);
    expect(res.body).toMatchObject({ success: true, targetUid: "uid-1", role: "admin" });
  });

  it("defaults a missing targetUid", async () => {
    const { app } = createTestApp();
    const res = await request(app).post("/api/admin/set-role").set(ADMIN_AUTH).send({}).expect(200);
    expect(res.body.targetUid).toBe("current-user");
  });

  it("audits the role change with the acting admin", async () => {
    const { app, audit } = createTestApp();
    await request(app)
      .post("/api/admin/set-role")
      .set(ADMIN_AUTH)
      .send({ targetUid: "uid-9", role: "admin" })
      .expect(200);
    expect(audit.list()[0]).toMatchObject({ action: "ROLE_UPDATED", actor: "admin-master" });
    expect(audit.list()[0].details).toBe("Set role for uid-9 to admin");
  });
});

describe("POST /api/admin/test-rbac", () => {
  it("echoes the resolved admin identity", async () => {
    const { app } = createTestApp();
    const res = await request(app).post("/api/admin/test-rbac").set(ADMIN_AUTH).expect(200);
    expect(res.body).toMatchObject({ authorized: true });
    expect(res.body.user).toMatchObject({ role: "admin", uid: "admin-master" });
  });
});
