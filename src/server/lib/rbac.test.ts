import { describe, expect, it, vi } from "vitest";
import { createAuditLogStore } from "./auditLog";
import {
  STATIC_ADMIN_TOKEN,
  createVerifyAdmin,
  decodeJwtClaims,
  extractBearerToken,
  isDesignatedAdminEmail,
  resolveAdminIdentity,
} from "./rbac";

/** Builds an unsigned JWT with the given payload, as the client would send. */
function makeJwt(claims: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
  return `${header}.${payload}.signature`;
}

describe("extractBearerToken", () => {
  it("pulls the credential out of a well-formed header", () => {
    expect(extractBearerToken("Bearer abc123")).toBe("abc123");
  });

  it("returns null for absent, malformed, or empty credentials", () => {
    for (const header of [
      undefined,
      "",
      "abc123",
      "bearer abc123", // case-sensitive by design
      "Basic abc123",
      "Bearer ",
      "Bearer    ",
    ]) {
      expect(extractBearerToken(header), String(header)).toBeNull();
    }
  });

  it("uses the first value when a header is repeated", () => {
    expect(extractBearerToken(["Bearer first", "Bearer second"])).toBe("first");
  });
});

describe("decodeJwtClaims", () => {
  it("decodes a base64url payload segment", () => {
    expect(decodeJwtClaims(makeJwt({ admin: true, email: "a@b.c" }))).toEqual({
      admin: true,
      email: "a@b.c",
    });
  });

  it("returns null for structurally invalid tokens", () => {
    for (const token of ["", "onlyonepart", "a.b", "a..c", "a.!!!not-base64!!!.c"]) {
      expect(decodeJwtClaims(token), token).toBeNull();
    }
  });

  it("returns null when the payload is valid base64 but not a JSON object", () => {
    const asArray = `h.${Buffer.from(JSON.stringify([1, 2, 3])).toString("base64url")}.s`;
    const asString = `h.${Buffer.from(JSON.stringify("nope")).toString("base64url")}.s`;
    expect(decodeJwtClaims(asArray)).toBeNull();
    expect(decodeJwtClaims(asString)).toBeNull();
  });
});

describe("resolveAdminIdentity", () => {
  it("grants access for the static admin token", () => {
    const grant = resolveAdminIdentity({ authorization: `Bearer ${STATIC_ADMIN_TOKEN}` });
    expect(grant.authorized).toBe(true);
    if (!grant.authorized) return;
    expect(grant.via).toBe("static-token");
    expect(grant.identity).toMatchObject({ role: "admin", uid: "admin-master" });
  });

  it("grants access for the x-admin-role simulation header", () => {
    const grant = resolveAdminIdentity({ "x-admin-role": "admin" });
    expect(grant.authorized).toBe(true);
    if (grant.authorized) expect(grant.via).toBe("role-header");
  });

  it("grants access for a JWT carrying admin: true", () => {
    const grant = resolveAdminIdentity({
      authorization: `Bearer ${makeJwt({ admin: true, email: "ops@reflectai.cloud", sub: "uid-1" })}`,
    });
    expect(grant.authorized).toBe(true);
    if (!grant.authorized) return;
    expect(grant.via).toBe("jwt-claim");
    expect(grant.actor).toBe("ops@reflectai.cloud");
    expect(grant.identity.role).toBe("admin");
  });

  it("grants access for a JWT carrying role: admin", () => {
    const grant = resolveAdminIdentity({ authorization: `Bearer ${makeJwt({ role: "admin" })}` });
    expect(grant.authorized).toBe(true);
  });

  it("grants access for the designated admin email fadlysyah96@gmail.com via JWT claim", () => {
    const grant = resolveAdminIdentity({
      authorization: `Bearer ${makeJwt({ email: "fadlysyah96@gmail.com", sub: "fadly-uid" })}`,
    });
    expect(grant.authorized).toBe(true);
    if (!grant.authorized) return;
    expect(grant.via).toBe("jwt-claim");
    expect(grant.actor).toBe("fadlysyah96@gmail.com");
    expect(grant.identity.role).toBe("admin");
  });

  it("grants access for the designated admin email via x-admin-email header", () => {
    const grant = resolveAdminIdentity({
      "x-admin-email": "fadlysyah96@gmail.com",
    });
    expect(grant.authorized).toBe(true);
    if (!grant.authorized) return;
    expect(grant.via).toBe("role-header");
    expect(grant.actor).toBe("fadlysyah96@gmail.com");
    expect(grant.identity.role).toBe("admin");
  });

  it("denies access to regular new registrant emails without admin privilege", () => {
    const grant = resolveAdminIdentity({
      authorization: `Bearer ${makeJwt({ email: "newuser@example.com", role: "user", sub: "new-uid" })}`,
    });
    expect(grant.authorized).toBe(false);
  });

  it("validates isDesignatedAdminEmail helper accuracy", () => {
    expect(isDesignatedAdminEmail("fadlysyah96@gmail.com")).toBe(true);
    expect(isDesignatedAdminEmail("FADLYSYAH96@GMAIL.COM")).toBe(true);
    expect(isDesignatedAdminEmail("  fadlysyah96@gmail.com  ")).toBe(true);
    expect(isDesignatedAdminEmail("other@gmail.com")).toBe(false);
    expect(isDesignatedAdminEmail("")).toBe(false);
    expect(isDesignatedAdminEmail(null)).toBe(false);
    expect(isDesignatedAdminEmail(undefined)).toBe(false);
  });

  it("falls back to sub as the actor when no email claim is present", () => {
    const grant = resolveAdminIdentity({
      authorization: `Bearer ${makeJwt({ admin: true, sub: "uid-42" })}`,
    });
    expect(grant.authorized && grant.actor).toBe("uid-42");
  });

  it("denies an anonymous request", () => {
    const grant = resolveAdminIdentity({});
    expect(grant.authorized).toBe(false);
    expect(grant.authorized === false && grant.reason).toMatch(/Admin privileges required/);
  });

  it("denies a non-admin JWT — the core privilege-escalation guard", () => {
    for (const claims of [
      { admin: false },
      { role: "user" },
      { role: "USER" },
      { admin: "true" }, // string, not boolean
      { admin: 1 }, // truthy but not === true
      { sub: "uid-1" },
      {},
    ]) {
      const grant = resolveAdminIdentity({
        authorization: `Bearer ${makeJwt(claims)}`,
      });
      expect(grant.authorized, JSON.stringify(claims)).toBe(false);
    }
  });

  it("denies a wrong static token and a near-miss role header", () => {
    expect(resolveAdminIdentity({ authorization: "Bearer admin-session-toke" }).authorized).toBe(
      false
    );
    expect(resolveAdminIdentity({ authorization: "Bearer ADMIN-SESSION-TOKEN" }).authorized).toBe(
      false
    );
    for (const role of ["Admin", "ADMIN", "user", "superadmin", ""]) {
      expect(resolveAdminIdentity({ "x-admin-role": role }).authorized, role).toBe(false);
    }
  });

  it("denies a garbage token without throwing", () => {
    for (const token of ["...", "a.b.c.d.e", "%%%.%%%.%%%"]) {
      expect(() => resolveAdminIdentity({ authorization: `Bearer ${token}` })).not.toThrow();
      expect(resolveAdminIdentity({ authorization: `Bearer ${token}` }).authorized).toBe(false);
    }
  });
});

describe("createVerifyAdmin middleware", () => {
  function invoke(headers: Record<string, string>) {
    const audit = createAuditLogStore();
    const verifyAdmin = createVerifyAdmin(audit);
    const req = { headers, method: "GET", path: "/api/admin/metrics" } as any;
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() } as any;
    const next = vi.fn();
    verifyAdmin(req, res, next);
    return { audit, req, res, next };
  }

  it("calls next and attaches the identity when authorized", () => {
    const { req, res, next, audit } = invoke({ authorization: `Bearer ${STATIC_ADMIN_TOKEN}` });
    expect(next).toHaveBeenCalledOnce();
    expect(res.status).not.toHaveBeenCalled();
    expect(req.user).toMatchObject({ role: "admin" });
    expect(audit.list()[0]).toMatchObject({ action: "RBAC_ACCESS_GRANTED", status: "success" });
  });

  it("responds 403 and records a warning when denied", () => {
    const { res, next, audit } = invoke({});
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({
      error: "Access denied: Admin privileges required.",
    });
    expect(audit.list()[0]).toMatchObject({
      action: "RBAC_ACCESS_DENIED",
      actor: "unauthorized_caller",
      status: "warn",
    });
  });

  it("never leaks the identity onto the request when denied", () => {
    const { req } = invoke({ authorization: "Bearer not-the-token" });
    expect(req.user).toBeUndefined();
  });
});
