export type ReflectionMode = 'thoughtful' | 'analytical' | 'creative' | 'actionable';

export interface InteractionTurn {
  id: string;
  role: 'user' | 'model';
  content: string;
  timestamp: number;
}

export interface EntryLocation {
  latitude: number;
  longitude: number;
  formattedAddress?: string;
  placeId?: string;
}

export interface JournalEntry {
  id: string;
  userId: string;
  title: string;
  category: string;
  mode: ReflectionMode;
  turns: InteractionTurn[];
  summary?: string;
  takeaways?: string[];
  sentiment?: string;
  location?: EntryLocation;
  createdAt: number;
  updatedAt: number;
}

export interface UserProfile {
  uid: string;
  email: string | null;
  displayName: string | null;
  photoURL: string | null;
  role?: 'admin' | 'user';
}

export type NotificationChannel = 'webhook' | 'discord' | 'email';

export interface NotificationEvent {
  id: string;
  channel: NotificationChannel;
  entryId: string;
  title: string;
  summary: string;
  timestamp: number;
  status: 'delivered' | 'failed' | 'simulated';
  recipientOrWebhook?: string;
}

export interface AuditLogItem {
  id: string;
  timestamp: number;
  action: string;
  actor: string;
  details: string;
  status: 'success' | 'warn' | 'error';
}
