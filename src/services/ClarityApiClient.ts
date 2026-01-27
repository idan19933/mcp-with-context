/**
 * Clarity API Client
 * Handles all HTTP communication with Clarity PPM REST API
 */

import type { ClarityConfig } from '../types/clarity.js';

export class ClarityApiClient {
  private baseUrl: string;
  private headers: Record<string, string>;
  private timeout: number;
  private maxRetries: number;

  constructor(config: ClarityConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, '');
    this.timeout = config.timeout ?? 30000;
    this.maxRetries = config.maxRetries ?? 3;

    // Build auth headers
    this.headers = {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    };

    if (config.authToken) {
      this.headers['Authorization'] = `Bearer ${config.authToken}`;
    } else if (config.sessionId) {
      this.headers['Cookie'] = `JSESSIONID=${config.sessionId}`;
    } else if (config.username && config.password) {
      const credentials = Buffer.from(`${config.username}:${config.password}`).toString('base64');
      this.headers['Authorization'] = `Basic ${credentials}`;
    }
  }

  async get<T = Record<string, unknown>>(endpoint: string): Promise<T & { _results?: unknown[]; _totalCount?: number }> {
    return this.request<T>('GET', endpoint);
  }

  async post<T = Record<string, unknown>>(endpoint: string, body: Record<string, unknown>): Promise<T & { _internalId?: number }> {
    return this.request<T>('POST', endpoint, body);
  }

  async patch<T = Record<string, unknown>>(endpoint: string, body: Record<string, unknown>): Promise<T> {
    return this.request<T>('PATCH', endpoint, body);
  }

  async delete<T = Record<string, unknown>>(endpoint: string): Promise<T> {
    return this.request<T>('DELETE', endpoint);
  }

  private async request<T>(
    method: string,
    endpoint: string,
    body?: Record<string, unknown>
  ): Promise<T & { _results?: unknown[]; _totalCount?: number; _internalId?: number }> {
    const url = `${this.baseUrl}${endpoint.startsWith('/') ? endpoint : '/' + endpoint}`;
    
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < this.maxRetries; attempt++) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), this.timeout);

        const response = await fetch(url, {
          method,
          headers: this.headers,
          body: body ? JSON.stringify(body) : undefined,
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`HTTP ${response.status}: ${errorText}`);
        }

        const data = await response.json();
        return data as T & { _results?: unknown[]; _totalCount?: number; _internalId?: number };
        
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        
        // Don't retry on auth errors
        if (lastError.message.includes('401') || lastError.message.includes('403')) {
          throw lastError;
        }
        
        // Wait before retry
        if (attempt < this.maxRetries - 1) {
          await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)));
        }
      }
    }

    throw lastError ?? new Error('Request failed');
  }
}

export function createClarityClient(config?: Partial<ClarityConfig>): ClarityApiClient {
  return new ClarityApiClient({
    baseUrl: config?.baseUrl ?? process.env['CLARITY_BASE_URL'] ?? '',
    username: config?.username ?? process.env['CLARITY_USERNAME'],
    password: config?.password ?? process.env['CLARITY_PASSWORD'],
    sessionId: config?.sessionId ?? process.env['CLARITY_SESSION_ID'],
    authToken: config?.authToken ?? process.env['CLARITY_AUTH_TOKEN'],
    timeout: config?.timeout,
    maxRetries: config?.maxRetries,
  });
}
