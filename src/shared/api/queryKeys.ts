/**
 * Centralized React Query key factory.
 * Use these instead of inline arrays for cache invalidation safety.
 */
export const queryKeys = {
  agents: {
    all: ["agents"] as const,
    list: (filters?: Record<string, unknown>) => ["agents", "list", filters] as const,
    detail: (id: string) => ["agents", "detail", id] as const,
    metrics: (id: string, period?: string) => ["agents", "metrics", id, period] as const,
  },
  applications: {
    all: ["applications"] as const,
    list: (filters?: Record<string, unknown>) => ["applications", "list", filters] as const,
    detail: (id: string) => ["applications", "detail", id] as const,
  },
  production: {
    all: ["production"] as const,
    daily: (agentId: string, date: string) => ["production", "daily", agentId, date] as const,
    range: (start: string, end: string) => ["production", "range", start, end] as const,
  },
  contentLibrary: {
    all: ["content_library"] as const,
    list: (filters?: Record<string, unknown>) => ["content_library", "list", filters] as const,
  },
  notifications: {
    all: ["notifications"] as const,
    unread: (userId: string) => ["notifications", "unread", userId] as const,
  },
  audit: {
    list: (filters?: Record<string, unknown>) => ["audit_log", filters] as const,
  },
} as const;
