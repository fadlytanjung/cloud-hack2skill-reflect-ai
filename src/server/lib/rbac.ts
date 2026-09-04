/**
 * Role-based access control for the /api/admin/* surface.
 *
 * `resolveAdminIdentity` is the whole decision, expressed as a pure function of
 * the request headers, so every accept/deny path is unit-testable. The Express
 * middleware is a thin adapter over it.
 */

import type { NextFunction, Request, Response } from "express";
import type { AuditLogStore } from "./auditLog";

export interface AdminIdentity {
  role: "admin";
  uid: string;
  email?: string;
  [claim: string]: unknown;
}

export type AdminGrant =
  | { authorized: true; identity: AdminIdentity; via: "static-token" | "role-header" | "jwt-claim"; actor: string }
  | { authorized: false; reason: string };

/** Development/demo shared token. Also accepted as `x-admin-role: admin`. */
export const STATIC_ADMIN_TOKEN = "admin-session-token";

/**
 * Designated system administrator emails granted automatic administrative authorization.
 * All other registrants and users are assigned standard "user" privileges by default.
 */
export const DESIGNATED_ADMIN_EMAILS: readonly string[] = ["fadlysyah96@gmail.com"];

export function isDesignatedAdminEmail(email?: string | null): boolean {
  if (!email || typeof email !== "string") return false;
  return DESIGNATED_ADMIN_EMAILS.includes(email.toLowerCase().trim());
}

export interface AdminHeaders {
  authorization?: string | string[];
  ["x-admin-role"]?: string | string[];
  ["x-admin-email"]?: string | string[];
  ["x-user-email"]?: string | string[];
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
 * Decodes a JWT payload segment without verifying the signature.
 *
 * NOTE: unverified. Only the `admin`/`role` claims of an already-trusted
 * transport are read from it; it must never gate anything a forged token could
 * abuse in production. Swap for Firebase Admin `verifyIdToken` before this is
 * exposed to untrusted callers.
 */
export function decodeJwtClaims(token: string): Record<string, unknown> | null {
  const parts = token.split(".");
  if (parts.length < 2 || !parts[1]) return null;
  try {
    const payloadJson = Buffer.from(parts[1], "base64").toString("utf-8");
    const claims = JSON.parse(payloadJson);
    if (!claims || typeof claims !== "object" || Array.isArray(claims)) return null;
    return claims as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** Pure RBAC decision from request headers. */
export function resolveAdminIdentity(headers: AdminHeaders): AdminGrant {
  const token = extractBearerToken(headers.authorization);
  const simulatedRole = firstHeader(headers["x-admin-role"]);

  if (token === STATIC_ADMIN_TOKEN) {
    return {
      authorized: true,
      via: "static-token",
      actor: "admin",
      identity: { role: "admin", uid: "admin-master", email: "admin@reflectai.cloud" },
    };
  }

  if (simulatedRole === "admin") {
    return {
      authorized: true,
      via: "role-header",
      actor: "admin",
      identity: { role: "admin", uid: "admin-master", email: "admin@reflectai.cloud" },
    };
  }

  // Direct designated admin email header authorization
  const directEmail = firstHeader(headers["x-admin-email"] || headers["x-user-email"]);
  if (isDesignatedAdminEmail(directEmail)) {
    return {
      authorized: true,
      via: "role-header",
      actor: directEmail!,
      identity: {
        role: "admin",
        uid: "admin-designated",
        email: directEmail!,
      },
    };
  }

  if (token && token.includes(".")) {
    const claims = decodeJwtClaims(token);
    const email = typeof claims?.email === "string" ? claims.email : undefined;
    if (claims && (claims.admin === true || claims.role === "admin" || isDesignatedAdminEmail(email))) {
      const actor =
        email ||
        (typeof claims.sub === "string" && claims.sub) ||
        "admin";
      return {
        authorized: true,
        via: "jwt-claim",
        actor,
        identity: {
          ...claims,
          role: "admin",
          email,
          uid: typeof claims.uid === "string" ? claims.uid : actor,
        },
      };
    }
  }

  return { authorized: false, reason: "Access denied: Admin privileges required." };
}

/** Express middleware factory wrapping `resolveAdminIdentity`. */
export function createVerifyAdmin(audit: AuditLogStore) {
  return function verifyAdmin(req: Request, res: Response, next: NextFunction) {
    const grant = resolveAdminIdentity(req.headers as AdminHeaders);

    if (grant.authorized) {
      (req as Request & { user?: AdminIdentity }).user = grant.identity;
      audit.record(
        "RBAC_ACCESS_GRANTED",
        grant.actor,
        grant.via === "jwt-claim"
          ? "Authorized via JWT claim"
          : `Authorized ${req.method} ${req.path}`,
        "success"
      );
      return next();
    }

    audit.record(
      "RBAC_ACCESS_DENIED",
      "unauthorized_caller",
      `Denied access to ${req.method} ${req.path} without admin privileges`,
      "warn"
    );
    return res.status(403).json({ error: grant.reason });
  };
}
