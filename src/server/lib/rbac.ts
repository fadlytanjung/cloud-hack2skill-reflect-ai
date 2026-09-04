/**
 * Role-based access control for the /api/admin/* surface.
 *
 * Administrator status is **predefined data**: the document `users/{uid}` in
 * Cloud Firestore carries `role: "admin"`, seeded out of band with
 * `scripts/set-user-role.sh`. Everyone who signs in is a standard user until
 * that document says otherwise.
 *
 * Two rules make this trustworthy:
 *
 *  1. The caller's identity comes from a **cryptographically verified** Firebase
 *     ID token, never from a request header. Headers are attacker-controlled.
 *  2. The role is looked up by the **uid inside that verified token**, so a
 *     caller cannot ask about someone else's privileges.
 *
 * `decideAdminAccess` is the whole authorization decision as a pure function, so
 * every accept and deny path is unit-testable without Firebase.
 */

import type { NextFunction, Request, Response } from "express";
import type { AuditLogStore } from "./auditLog";

export const ADMIN_ROLE = "admin" as const;

/** The subset of a verified Firebase ID token this module reads. */
export interface VerifiedToken {
  uid: string;
  email?: string | null;
  /** Custom claims, set server-side via the Admin SDK. */
  admin?: unknown;
  role?: unknown;
  [claim: string]: unknown;
}

export interface AdminIdentity {
  role: typeof ADMIN_ROLE;
  uid: string;
  email?: string | null;
}

export type GrantSource = "firestore-role" | "custom-claim" | "insecure-dev-bypass";

export type AdminGrant =
  | { authorized: true; identity: AdminIdentity; via: GrantSource; actor: string }
  | { authorized: false; reason: string };

/** Single denial message for every failure, so it reveals nothing. */
export const ACCESS_DENIED_REASON = "Access denied: Admin privileges required.";
export const UNVERIFIED_REASON = "Access denied: credential could not be verified.";

export interface AdminHeaders {
  authorization?: string | string[];
  /** Only consulted when `allowInsecureAdmin` is explicitly enabled. */
  ["x-admin-role"]?: string | string[];
}

function firstHeader(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/** Extracts the bearer credential, or null when absent/malformed. */
export function extractBearerToken(authorization: string | string[] | undefined): string | null {
  const header = firstHeader(authorization);
  if (!header || !header.startsWith("Bearer ")) return null;
  const token = header.slice("Bearer ".length).trim();
  return token.length > 0 ? token : null;
}

/**
 * The authorization decision, given an already-verified token and the role
 * stored in Firestore. Pure.
 *
 * A custom claim is honoured as well as the stored role so that an admin stays
 * an admin when Firestore is unreachable, and so `setCustomUserClaims` remains
 * a usable escalation path for automation.
 */
export function decideAdminAccess(input: {
  claims: VerifiedToken;
  storedRole: string | null | undefined;
}): AdminGrant {
  const { claims, storedRole } = input;
  const identity: AdminIdentity = {
    role: ADMIN_ROLE,
    uid: claims.uid,
    email: claims.email ?? null,
  };
  const actor = (typeof claims.email === "string" && claims.email) || claims.uid;

  if (storedRole === ADMIN_ROLE) {
    return { authorized: true, via: "firestore-role", actor, identity };
  }

  // Strict equality: "true", 1 and {} are not an admin claim.
  if (claims.admin === true || claims.role === ADMIN_ROLE) {
    return { authorized: true, via: "custom-claim", actor, identity };
  }

  return { authorized: false, reason: ACCESS_DENIED_REASON };
}

export type TokenVerifier = (idToken: string) => Promise<VerifiedToken | null>;
export type RoleLookup = (uid: string) => Promise<string | null>;

export interface AdminResolverDeps {
  verifyIdToken: TokenVerifier;
  getUserRole: RoleLookup;
  /**
   * Local-development escape hatch: accept `x-admin-role: admin` with no token.
   * NEVER enable in production — it is a full authentication bypass. `app.ts`
   * only sets it when ALLOW_INSECURE_ADMIN=1 and NODE_ENV is not production.
   */
  allowInsecureAdmin?: boolean;
}

/** Resolves the caller's admin status from the request headers. */
export async function resolveAdminIdentity(
  headers: AdminHeaders,
  deps: AdminResolverDeps
): Promise<AdminGrant> {
  if (deps.allowInsecureAdmin && firstHeader(headers["x-admin-role"]) === ADMIN_ROLE) {
    return {
      authorized: true,
      via: "insecure-dev-bypass",
      actor: "insecure-dev-bypass",
      identity: { role: ADMIN_ROLE, uid: "dev-admin", email: null },
    };
  }

  const idToken = extractBearerToken(headers.authorization);
  if (!idToken) {
    return { authorized: false, reason: ACCESS_DENIED_REASON };
  }

  let claims: VerifiedToken | null;
  try {
    claims = await deps.verifyIdToken(idToken);
  } catch {
    // A verifier outage must not be mistaken for a valid credential.
    return { authorized: false, reason: UNVERIFIED_REASON };
  }
  if (!claims?.uid) {
    return { authorized: false, reason: ACCESS_DENIED_REASON };
  }

  // Look the role up by the uid the token proves, never by anything the caller
  // supplied alongside it.
  let storedRole: string | null = null;
  try {
    storedRole = await deps.getUserRole(claims.uid);
  } catch {
    // Fall through: a custom claim can still authorize.
    storedRole = null;
  }

  return decideAdminAccess({ claims, storedRole });
}

export interface VerifyAdminDeps extends AdminResolverDeps {
  audit: AuditLogStore;
}

/** Express middleware wrapping `resolveAdminIdentity`. */
export function createVerifyAdmin(deps: VerifyAdminDeps) {
  return async function verifyAdmin(req: Request, res: Response, next: NextFunction) {
    const grant = await resolveAdminIdentity(req.headers as AdminHeaders, deps);

    if (grant.authorized) {
      (req as Request & { user?: AdminIdentity }).user = grant.identity;
      deps.audit.record(
        "RBAC_ACCESS_GRANTED",
        grant.actor,
        `Authorized ${req.method} ${req.path} via ${grant.via}`,
        grant.via === "insecure-dev-bypass" ? "warn" : "success"
      );
      return next();
    }

    deps.audit.record(
      "RBAC_ACCESS_DENIED",
      "unauthorized_caller",
      `Denied access to ${req.method} ${req.path} without admin privileges`,
      "warn"
    );
    // One message for every failure, so the response reveals nothing about
    // whether a token was malformed, expired, or simply not an admin's.
    return res.status(403).json({ error: ACCESS_DENIED_REASON });
  };
}
