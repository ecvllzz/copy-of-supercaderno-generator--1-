/*
  CacheManager provides a light-weight persistence layer for Gemini responses.
  The implementation intentionally keeps the API framework-agnostic so it can be
  consumed by both React clients (using localStorage) and Node environments
  (in-memory fallback). The hashing strategy mirrors the guidance from the
  analysis documents: we create deterministic keys based on the textual content
  of the request inputs.
*/

export interface CacheEntry<T> {
  value: T;
  timestamp: number;
  expiresAt: number;
}

const DEFAULT_TTL = 7 * 24 * 60 * 60 * 1000; // 7 days
const MAX_ENTRIES = 100;

function hasLocalStorage(): boolean {
  try {
    return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
  } catch (_) {
    return false;
  }
}

/**
 * Lightweight string hash helper that works in browser and Node without
 * requiring crypto APIs (which may be unavailable in some bundlers).
 */
export function hashContent(content: string): string {
  let hash = 0;
  for (let i = 0; i < content.length; i += 1) {
    hash = (hash << 5) - hash + content.charCodeAt(i);
    hash |= 0; // Convert to 32-bit integer
  }
  return Math.abs(hash).toString(36);
}

export class CacheManager {
  private cache: Map<string, CacheEntry<unknown>> = new Map();

  private readonly storageKey = 'supercaderno_cache_v1';

  private readonly storageAvailable = hasLocalStorage();

  constructor() {
    this.loadFromStorage();
  }

  get<T>(key: string): T | null {
    const entry = this.cache.get(key) as CacheEntry<T> | undefined;
    if (!entry) {
      return null;
    }

    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      this.persist();
      return null;
    }

    return entry.value;
  }

  set<T>(key: string, value: T, ttl: number = DEFAULT_TTL): void {
    const entry: CacheEntry<T> = {
      value,
      timestamp: Date.now(),
      expiresAt: Date.now() + ttl,
    };

    this.cache.set(key, entry);
    this.trim();
    this.persist();
  }

  clear(): void {
    this.cache.clear();
    if (this.storageAvailable) {
      window.localStorage.removeItem(this.storageKey);
    }
  }

  clearExpired(): void {
    const now = Date.now();
    let removed = false;
    for (const [key, entry] of this.cache.entries()) {
      if (entry.expiresAt <= now) {
        this.cache.delete(key);
        removed = true;
      }
    }

    if (removed) {
      this.persist();
    }
  }

  getStats(): { size: number; oldestEntry: number | null; newestEntry: number | null } {
    if (this.cache.size === 0) {
      return { size: 0, oldestEntry: null, newestEntry: null };
    }

    const timestamps = Array.from(this.cache.values()).map((entry) => entry.timestamp);
    return {
      size: this.cache.size,
      oldestEntry: Math.min(...timestamps),
      newestEntry: Math.max(...timestamps),
    };
  }

  private trim(): void {
    if (this.cache.size <= MAX_ENTRIES) {
      return;
    }

    const entries = Array.from(this.cache.entries()).sort(([, a], [, b]) => b.timestamp - a.timestamp);
    this.cache = new Map(entries.slice(0, MAX_ENTRIES));
  }

  private persist(): void {
    if (!this.storageAvailable) {
      return;
    }

    try {
      const serializable = Array.from(this.cache.entries());
      window.localStorage.setItem(this.storageKey, JSON.stringify(serializable));
    } catch (error) {
      console.warn('[Cache] Failed to persist cache:', error);
    }
  }

  private loadFromStorage(): void {
    if (!this.storageAvailable) {
      return;
    }

    try {
      const raw = window.localStorage.getItem(this.storageKey);
      if (!raw) {
        return;
      }

      const entries = JSON.parse(raw) as [string, CacheEntry<unknown>][];
      this.cache = new Map(entries);
      this.clearExpired();
    } catch (error) {
      console.warn('[Cache] Failed to load cache from storage:', error);
      this.cache.clear();
    }
  }
}

export const cache = new CacheManager();
