import { describe, expect, it, vi } from "vitest";
import { createAuditLogStore } from "./auditLog";
import {
  ADMIN_ROLE,
  createVerifyAdmin,
  decideAdminAccess,
  extractBearerToken,
  resolveAdminIdentity,
  type VerifiedToken,
} from "./rbac";

function token(overrides: Partial<VerifiedToken> = {}): VerifiedToken {
  return { uid: "uid-1", email: "someone@example.com", ...overrides };
}

/** Verifier that accepts one specific token string and rejects everything else. */
function verifierFor(accepted: string, decoded: VerifiedToken = token()) {
  return vi.fn(async (idToken: string) => (idToken === accepted ? decoded : null));
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

describe("decideAdminAccess", () => {
  it("grants when the stored Firestore role is admin", () => {
    // This is the intended path: role lives in users/{uid}, seeded out of band.
    expect(decideAdminAccess({ claims: token(), storedRole: "admin" }).authorized).toBe(true);
  });

  it("grants when the verified token carries an admin custom claim", () => {
    expect(decideAdminAccess({ claims: token({ admin: true }), storedRole: null }).authorized).toBe(
      true
    );
    expect(
      decideAdminAccess({ claims: token({ role: "admin" }), storedRole: null }).authorized
    ).toBe(true);
  });

  it("denies a standard user", () => {
    for (const storedRole of [null, undefined, "user", "USER", "editor", ""]) {
      const decision = decideAdminAccess({ claims: token(), storedRole: storedRole as any });
      expect(decision.authorized, String(storedRole)).toBe(false);
    }
  });

  it("denies a truthy-but-not-true admin claim", () => {
    for (const admin of ["true", 1, {}, [], "yes"]) {
      expect(
        decideAdminAccess({ claims: token({ admin } as any), storedRole: null }).authorized,
        JSON.stringify(admin)
      ).toBe(false);
    }
  });

  it("denies a role claim that is not exactly 'admin'", () => {
    for (const role of ["Admin", "ADMIN", "superadmin", "admin ", "user"]) {
      expect(
        decideAdminAccess({ claims: token({ role } as any), storedRole: null }).authorized,
        role
      ).toBe(false);
    }
  });

  it("ignores the email entirely — no address is privileged", () => {
    // The previous design granted admin to a hardcoded address, which was
    // inlined into the public bundle and trusted from a request header.
    for (const email of [
      "fadlysyah96@gmail.com",
      "admin@reflectai.cloud",
      "root@localhost",
      null,
    ]) {
      expect(
        decideAdminAccess({ claims: token({ email } as any), storedRole: null }).authorized,
        String(email)
      ).toBe(false);
    }
  });

  it("reports which source granted access, for the audit trail", () => {
    const stored = decideAdminAccess({ claims: token(), storedRole: "admin" });
    expect(stored.authorized && stored.via).toBe("firestore-role");
    const claim = decideAdminAccess({ claims: token({ admin: true }), storedRole: null });
    expect(claim.authorized && claim.via).toBe("custom-claim");
  });

  it("carries the verified uid and email into the identity", () => {
    const decision = decideAdminAccess({
      claims: token({ uid: "uid-9", email: "ops@example.com" }),
      storedRole: "admin",
    });
    expect(decision.authorized && decision.identity).toMatchObject({
      uid: "uid-9",
      email: "ops@example.com",
      role: ADMIN_ROLE,
    });
  });
});

describe("resolveAdminIdentity", () => {
  const deps = (over: Partial<Parameters<typeof resolveAdminIdentity>[1]> = {}) => ({
    verifyIdToken: verifierFor("good-token"),
    getUserRole: vi.fn(async () => "admin" as const),
    ...over,
  });

  it("grants an admin presenting a verified ID token", async () => {
    const grant = await resolveAdminIdentity({ authorization: "Bearer good-token" }, deps());
    expect(grant.authorized).toBe(true);
  });

  it("denies a request with no Authorization header, without any lookup", async () => {
    const d = deps();
    const grant = await resolveAdminIdentity({}, d);
    expect(grant.authorized).toBe(false);
    expect(d.verifyIdToken).not.toHaveBeenCalled();
    expect(d.getUserRole).not.toHaveBeenCalled();
  });

  it("denies a token the verifier rejects, and never looks up a role for it", async () => {
    const d = deps();
    const grant = await resolveAdminIdentity({ authorization: "Bearer forged" }, d);
    expect(grant.authorized).toBe(false);
    expect(d.getUserRole).not.toHaveBeenCalled();
  });

  it("no longer honours the removed trusted headers", async () => {
    // Each of these previously granted full admin on a public service.
    for (const headers of [
      { "x-admin-role": "admin" },
      { "x-user-email": "fadlysyah96@gmail.com" },
      { "x-admin-email": "fadlysyah96@gmail.com" },
      { authorization: "Bearer admin-session-token" },
    ]) {
      const grant = await resolveAdminIdentity(headers as any, deps());
      expect(grant.authorized, JSON.stringify(headers)).toBe(false);
    }
  });

  it("denies an unsigned token whose payload merely claims admin", async () => {
    // A real verifier rejects this; the point is that nothing else reads it.
    const payload = Buffer.from(JSON.stringify({ admin: true })).toString("base64url");
    const grant = await resolveAdminIdentity(
      { authorization: `Bearer header.${payload}.sig` },
      deps({ verifyIdToken: vi.fn(async () => null) })
    );
    expect(grant.authorized).toBe(false);
  });

  it("looks the role up by the uid from the verified token, not from the request", async () => {
    const d = deps({ verifyIdToken: verifierFor("good-token", token({ uid: "verified-uid" })) });
    await resolveAdminIdentity(
      { authorization: "Bearer good-token", "x-user-email": "attacker@example.com" } as any,
      d
    );
    expect(d.getUserRole).toHaveBeenCalledWith("verified-uid");
  });

  it("denies a verified non-admin user", async () => {
    const grant = await resolveAdminIdentity(
      { authorization: "Bearer good-token" },
      deps({ getUserRole: vi.fn(async () => "user") })
    );
    expect(grant.authorized).toBe(false);
  });

  it("denies rather than throwing when the verifier itself fails", async () => {
    const grant = await resolveAdminIdentity(
      { authorization: "Bearer good-token" },
      deps({ verifyIdToken: vi.fn(async () => { throw new Error("cert fetch failed"); }) })
    );
    expect(grant.authorized).toBe(false);
    expect(grant.authorized === false && grant.reason).toMatch(/could not be verified/i);
  });

  it("still grants on a custom claim when the role lookup fails", async () => {
    // Firestore being unreachable must not lock a claim-bearing admin out.
    const grant = await resolveAdminIdentity(
      { authorization: "Bearer good-token" },
      deps({
        verifyIdToken: verifierFor("good-token", token({ admin: true })),
        getUserRole: vi.fn(async () => { throw new Error("firestore down"); }),
      })
    );
    expect(grant.authorized).toBe(true);
  });

  it("denies when the role lookup fails and there is no claim", async () => {
    const grant = await resolveAdminIdentity(
      { authorization: "Bearer good-token" },
      deps({ getUserRole: vi.fn(async () => { throw new Error("firestore down"); }) })
    );
    expect(grant.authorized).toBe(false);
  });
});

describe("insecure development bypass", () => {
  const deps = {
    verifyIdToken: vi.fn(async () => null),
    getUserRole: vi.fn(async () => null),
  };

  it("is off unless explicitly enabled", async () => {
    expect((await resolveAdminIdentity({ "x-admin-role": "admin" } as any, deps)).authorized).toBe(
      false
    );
  });

  it("grants on the dev header only when explicitly enabled", async () => {
    const grant = await resolveAdminIdentity({ "x-admin-role": "admin" } as any, {
      ...deps,
      allowInsecureAdmin: true,
    });
    expect(grant.authorized).toBe(true);
    expect(grant.authorized && grant.via).toBe("insecure-dev-bypass");
  });

  it("still denies without the dev header even when enabled", async () => {
    expect(
      (await resolveAdminIdentity({}, { ...deps, allowInsecureAdmin: true })).authorized
    ).toBe(false);
  });
});

describe("createVerifyAdmin middleware", () => {
  async function invoke(
    headers: Record<string, string>,
    over: Parameters<typeof createVerifyAdmin>[0] | null = null
  ) {
    const audit = createAuditLogStore();
    const verifyAdmin = createVerifyAdmin(
      over ?? {
        audit,
        verifyIdToken: verifierFor("good-token"),
        getUserRole: async () => "admin",
      }
    );
    const req = { headers, method: "GET", path: "/api/admin/metrics" } as any;
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() } as any;
    const next = vi.fn();
    await verifyAdmin(req, res, next);
    return { audit, req, res, next };
  }

  it("calls next and attaches the verified identity when authorized", async () => {
    const { req, res, next } = await invoke({ authorization: "Bearer good-token" });
    expect(next).toHaveBeenCalledOnce();
    expect(res.status).not.toHaveBeenCalled();
    expect(req.user).toMatchObject({ role: ADMIN_ROLE, uid: "uid-1" });
  });

  it("audits a grant with the verified actor", async () => {
    const { audit } = await invoke({ authorization: "Bearer good-token" });
    expect(audit.list()[0]).toMatchObject({
      action: "RBAC_ACCESS_GRANTED",
      actor: "someone@example.com",
      status: "success",
    });
  });

  it("responds 403 and audits a warning when denied", async () => {
    const { res, next, audit } = await invoke({});
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(audit.list()[0]).toMatchObject({
      action: "RBAC_ACCESS_DENIED",
      actor: "unauthorized_caller",
      status: "warn",
    });
  });

  it("never attaches an identity when denied", async () => {
    const { req } = await invoke({ authorization: "Bearer forged" });
    expect(req.user).toBeUndefined();
  });

  it("does not leak why the token failed", async () => {
    // A precise reason tells an attacker whether a uid exists.
    const { res } = await invoke({ authorization: "Bearer forged" });
    expect(res.json).toHaveBeenCalledWith({
      error: "Access denied: Admin privileges required.",
    });
  });
});
