/**
 * Outbound notification payload shaping and history.
 *
 * Payload builders are pure: what leaves the process for a webhook or Discord
 * can be asserted byte-for-byte without a network call.
 */

import { sanitizeNotificationPayload } from "./security";

export type NotificationChannel = "webhook" | "discord" | "email";
export type DispatchStatus = "delivered" | "simulated" | "failed";

export interface NotificationRecord {
  id: string;
  channel: NotificationChannel;
  entryId: string;
  title: string;
  summary: string;
  timestamp: number;
  status: DispatchStatus;
  recipientOrWebhook: string;
}

/** Anything not explicitly discord/email is treated as a generic webhook. */
export function resolveChannel(value: unknown): NotificationChannel {
  if (value === "discord") return "discord";
  if (value === "email") return "email";
  return "webhook";
}

export function isDiscordWebhook(url: string): boolean {
  return url.includes("discord.com/api/webhooks/");
}

/** Discord rejects embed descriptions over 2000 characters. */
export const DISCORD_DESCRIPTION_LIMIT = 2000;

export function truncateForDiscord(text: string): string {
  return text.length > DISCORD_DESCRIPTION_LIMIT
    ? `${text.slice(0, DISCORD_DESCRIPTION_LIMIT - 3)}...`
    : text;
}

export interface DispatchFields {
  title: string;
  summary: string;
  entryId: string;
  timestamp: number;
}

/** Generic JSON webhook body; gains Discord `content` when the target is Discord. */
export function buildWebhookPayload(
  fields: DispatchFields,
  targetUrl: string
): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    event: "journal_reflection",
    title: fields.title,
    summary: fields.summary,
    entryId: fields.entryId,
    timestamp: fields.timestamp,
    source: "ReflectAI",
  };

  if (isDiscordWebhook(targetUrl)) {
    payload.content = `**New Reflection Synthesized: ${fields.title}**\n> ${fields.summary}`;
  }

  return payload;
}

/** Elegant forest sage, matching the app's accent. */
export const DISCORD_EMBED_COLOR = 0x476340;

export function buildDiscordPayload(
  fields: DispatchFields,
  projectLabel: string
): Record<string, unknown> {
  return {
    content: `🌿 **ReflectAI Synthesis: ${fields.title}**`,
    embeds: [
      {
        title: fields.title,
        description: truncateForDiscord(fields.summary),
        color: DISCORD_EMBED_COLOR,
        fields: [
          { name: "Entry ID", value: `\`${fields.entryId}\``, inline: true },
          { name: "Channel", value: "Discord Egress", inline: true },
          { name: "Cloud Project", value: projectLabel, inline: true },
        ],
        footer: {
          text: "ReflectAI Journal Assistant • Powered by Gemini & Google Cloud Run",
        },
        timestamp: new Date(fields.timestamp).toISOString(),
      },
    ],
  };
}

/** Truncated preview of a user-supplied URL, so full webhook tokens are not echoed back. */
export function describeWebhookTarget(url: string, isCustom: boolean): string {
  return isCustom ? `${url.slice(0, 30)}...` : "Configured Webhook (Secret Manager)";
}

export const DEFAULT_MAX_NOTIFICATION_HISTORY = 50;

export interface NotificationStore {
  add(record: NotificationRecord): NotificationRecord;
  list(): NotificationRecord[];
  get size(): number;
  clear(): void;
}

export function createNotificationStore(
  options: { maxEntries?: number; seed?: NotificationRecord[] } = {}
): NotificationStore {
  const maxEntries = options.maxEntries ?? DEFAULT_MAX_NOTIFICATION_HISTORY;
  const history: NotificationRecord[] = options.seed ? [...options.seed] : [];

  return {
    add(record) {
      history.unshift(record);
      while (history.length > maxEntries) {
        history.pop();
      }
      return record;
    },
    list() {
      return history.map((record) => ({ ...record }));
    },
    get size() {
      return history.length;
    },
    clear() {
      history.length = 0;
    },
  };
}

/** Sanitizes the caller-supplied title/summary pair used by every channel. */
export function sanitizeDispatchFields(input: {
  title?: unknown;
  summary?: unknown;
  entryId: string;
  timestamp: number;
}): DispatchFields {
  return {
    title: sanitizeNotificationPayload(
      typeof input.title === "string" && input.title.trim() ? input.title : "Journal Reflection"
    ),
    summary: sanitizeNotificationPayload(input.summary),
    entryId: input.entryId,
    timestamp: input.timestamp,
  };
}
