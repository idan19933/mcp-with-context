/**
 * Lookup Service
 * Handles resolution of lookup values in Clarity
 */

import type { LookupValue } from '../types/clarity.js';
import type { ClarityApiClient } from './ClarityApiClient.js';
import { CACHE_TTL } from '../constants.js';

export class LookupService {
  private readonly client: ClarityApiClient;
  private readonly lookupCache = new Map<string, LookupValue[]>();
  private readonly lookupTimestamps = new Map<string, number>();

  constructor(client: ClarityApiClient) {
    this.client = client;
  }

  async getLookupValues(lookupType: string): Promise<LookupValue[]> {
    const cacheKey = lookupType;
    const now = Date.now();
    
    if (
      this.lookupCache.has(cacheKey) &&
      now - (this.lookupTimestamps.get(cacheKey) ?? 0) < CACHE_TTL.LOOKUPS
    ) {
      return this.lookupCache.get(cacheKey)!;
    }

    try {
      const response = await this.client.get<Record<string, unknown>>(
        `/${lookupType}?fields=code,displayValue,name&limit=500`
      );

      const results = (response._results ?? []) as Array<Record<string, unknown>>;
      const values: LookupValue[] = results.map(item => ({
        code: String(item['code'] ?? item['_internalId'] ?? ''),
        displayValue: String(item['displayValue'] ?? item['name'] ?? item['code'] ?? ''),
      }));

      this.lookupCache.set(cacheKey, values);
      this.lookupTimestamps.set(cacheKey, now);

      return values;
    } catch (error) {
      console.error(`[LookupService] Failed to get lookup values for ${lookupType}:`, error);
      return [];
    }
  }

  async resolveDisplayToCode(lookupType: string, displayValue: string): Promise<string | null> {
    const values = await this.getLookupValues(lookupType);
    const lower = displayValue.toLowerCase();
    
    const exact = values.find(v => v.displayValue.toLowerCase() === lower);
    if (exact) return exact.code;
    
    const partial = values.find(v => 
      v.displayValue.toLowerCase().includes(lower) || 
      lower.includes(v.displayValue.toLowerCase())
    );
    if (partial) return partial.code;
    
    return null;
  }

  clearCache(): void {
    this.lookupCache.clear();
    this.lookupTimestamps.clear();
  }
}
