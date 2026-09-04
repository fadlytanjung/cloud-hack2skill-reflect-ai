/**
 * Request-boundary security primitives.
 *
 * Every function here is pure so the guards can be tested exhaustively without
 * spinning up an HTTP server or reaching the network.
 */

export interface ValidationResult {
  valid: boolean;
  /** Present only when `valid` is false. */
  reason?: string;
}

/** Loopback / link-local / RFC1918 hosts that must never be dialled outbound. */
const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "127.0.0.1",
  "0.0.0.0",
  "::1",
  "[::1]",
  "169.254.169.254", // GCP / AWS instance metadata
  "metadata.google.internal",
]);

const RFC1918_172 = /^172\.(1[6-9]|2[0-9]|3[0-1])\./;

/**
 * SSRF defense for user-supplied webhook endpoints (OWASP A10 / LLM01).
 * HTTPS only, and no private / metadata destinations.
 */
export function isValidWebhookUrl(urlStr: unknown): ValidationResult {
  if (typeof urlStr !== "string" || urlStr.trim() === "") {
    return { valid: false, reason: "Invalid Webhook URL syntax." };
  }

  let parsed: URL;
  try {
    parsed = new URL(urlStr);
  } catch {
    return { valid: false, reason: "Invalid Webhook URL syntax." };
  }

  if (parsed.protocol !== "https:") {
    return {
      valid: false,
      reason: "Only HTTPS webhook endpoints are permitted for transport security.",
    };
  }

  const hostname = parsed.hostname.toLowerCase();
  const isPrivate =
    BLOCKED_HOSTNAMES.has(hostname) ||
    hostname.startsWith("10.") ||
    hostname.startsWith("192.168.") ||
    hostname.startsWith("127.") ||
    RFC1918_172.test(hostname);

  if (isPrivate) {
    return {
      valid: false,
      reason: "Internal or private network endpoints are strictly forbidden (SSRF defense).",
    };
  }

  return { valid: true };
}

/**
 * Narrow coercion for coordinate input: a finite number, or a string that is
 * entirely a number. Everything else is rejected.
 *
 * `Number()` alone is too permissive here — it maps `null`, `""` and `false` to
 * 0 and `true` to 1, so a missing coordinate would read as a valid position.
 */
function toFiniteNumber(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

/**
 * Coordinate bounds check: latitude [-90, 90], longitude [-180, 180].
 * Rejects non-finite input so `Infinity` and `NaN` never reach the Maps API.
 */
export function validateCoordinates(lat: unknown, lng: unknown): ValidationResult {
  const parsedLat = toFiniteNumber(lat);
  const parsedLng = toFiniteNumber(lng);

  if (parsedLat === null || parsedLng === null) {
    return {
      valid: false,
      reason: "Latitude and Longitude must be valid numerical coordinates.",
    };
  }
  if (parsedLat < -90 || parsedLat > 90) {
    return { valid: false, reason: "Latitude must strictly be between -90 and 90 degrees." };
  }
  if (parsedLng < -180 || parsedLng > 180) {
    return { valid: false, reason: "Longitude must strictly be between -180 and 180 degrees." };
  }
  return { valid: true };
}

/** Maximum characters retained on an outbound notification field. */
export const NOTIFICATION_FIELD_LIMIT = 1500;

/**
 * Sanitizer for notification / external egress payloads (OWASP LLM02).
 * Neutralizes prompt-injection directives, strips markup, and truncates.
 */
export function sanitizeNotificationPayload(text: unknown): string {
  if (typeof text !== "string" || !text) return "";
  return text
    // Strip prompt injection directives
    .replace(
      /(?:ignore\s+all\s+previous\s+instructions|disregard\s+(?:all\s+)?(?:previous|prior)\s+instructions|system\s*:\s*|you\s+are\s+now)/gi,
      "[REDACTED_INSTRUCTION]"
    )
    // Strip HTML tags and script injections
    .replace(/<[^>]*>?/gm, "")
    // Strip raw javascript:/data: URI handlers
    .replace(/javascript:/gi, "")
    .replace(/data:text\/html/gi, "")
    .trim()
    .slice(0, NOTIFICATION_FIELD_LIMIT);
}

/** Strips markup from a free-text search query before it leaves the process. */
export function sanitizeAddressQuery(address: string): string {
  return address.replace(/<[^>]*>?/gm, "").trim();
}
