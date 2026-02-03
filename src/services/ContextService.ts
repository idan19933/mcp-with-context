/**
 * Context Service
 * Manages conversation context and memory across messages
 */

import type { 
  ConversationContext, 
  ConversationTurn, 
  DrillDownRequest,
} from '../types/context.js';

export class ContextService {
  // In-memory storage (per session)
  // In production, this could be Redis or similar
  private contexts: Map<string, ConversationContext> = new Map();
  
  // Maximum history length to keep
  private readonly MAX_HISTORY_LENGTH = 20;
  
  // Context expiry time (30 minutes)
  private readonly CONTEXT_EXPIRY_MS = 30 * 60 * 1000;

  /**
   * Get or create a context for a session
   */
  getContext(sessionId: string): ConversationContext {
    let context = this.contexts.get(sessionId);
    
    if (!context) {
      context = this.createNewContext(sessionId);
      this.contexts.set(sessionId, context);
    }
    
    return context;
  }

  /**
   * Create a new empty context
   */
  private createNewContext(sessionId: string): ConversationContext {
    return {
      sessionId,
      history: [],
    };
  }

  /**
   * Update context with a new query result
   */
  updateLastQuery(
    sessionId: string,
    query: ConversationContext['lastQuery']
  ): void {
    const context = this.getContext(sessionId);
    context.lastQuery = query;
    this.contexts.set(sessionId, context);
  }

  /**
   * Add a turn to conversation history
   */
  addToHistory(
    sessionId: string,
    turn: ConversationTurn
  ): void {
    const context = this.getContext(sessionId);
    
    context.history.push(turn);
    
    // Trim history if too long
    if (context.history.length > this.MAX_HISTORY_LENGTH) {
      context.history = context.history.slice(-this.MAX_HISTORY_LENGTH);
    }
    
    this.contexts.set(sessionId, context);
  }

  /**
   * Set current page context (from frontend)
   */
  setCurrentPage(
    sessionId: string,
    page: ConversationContext['currentPage']
  ): void {
    const context = this.getContext(sessionId);
    context.currentPage = page;
    this.contexts.set(sessionId, context);
  }

  /**
   * Update user preferences
   */
  updatePreferences(
    sessionId: string,
    preferences: Partial<NonNullable<ConversationContext['preferences']>>
  ): void {
    const context = this.getContext(sessionId);
    context.preferences = { ...context.preferences, ...preferences };
    this.contexts.set(sessionId, context);
  }

  /**
   * Check if user is doing a follow-up on previous chart/query
   */
  canDrillDown(sessionId: string): boolean {
    const context = this.getContext(sessionId);
    return !!(
      context.lastQuery?.chartData && 
      context.lastQuery?.groupByField
    );
  }

  /**
   * Get available drill-down values from last chart
   */
  getDrillDownOptions(sessionId: string): string[] {
    const context = this.getContext(sessionId);
    if (!context.lastQuery?.chartData || !context.lastQuery?.groupByField) {
      return [];
    }
    
    const chartData = context.lastQuery.chartData[context.lastQuery.groupByField];
    return chartData?.map(item => item.label) ?? [];
  }

  /**
   * Find matching drill-down value from user message
   */
  findDrillDownMatch(sessionId: string, userValue: string): string | null {
    const options = this.getDrillDownOptions(sessionId);
    const lowerUserValue = userValue.toLowerCase();
    
    // Exact match
    const exactMatch = options.find(opt => opt.toLowerCase() === lowerUserValue);
    if (exactMatch) return exactMatch;
    
    // Partial match
    const partialMatch = options.find(opt => 
      opt.toLowerCase().includes(lowerUserValue) || 
      lowerUserValue.includes(opt.toLowerCase())
    );
    if (partialMatch) return partialMatch;
    
    return null;
  }

  /**
   * Build drill-down request from context
   */
  buildDrillDownRequest(
    sessionId: string, 
    selectedValue: string
  ): DrillDownRequest | null {
    const context = this.getContext(sessionId);
    
    if (!context.lastQuery?.groupByField || !context.lastQuery?.objectType) {
      return null;
    }
    
    return {
      fromField: context.lastQuery.groupByField,
      selectedValue,
      objectType: context.lastQuery.objectType,
    };
  }

  /**
   * Get last object type queried (for follow-up questions)
   */
  getLastObjectType(sessionId: string): string | null {
    const context = this.getContext(sessionId);
    return context.lastQuery?.objectType ?? null;
  }

  /**
   * Get last object label (for display)
   */
  getLastObjectLabel(sessionId: string): string | null {
    const context = this.getContext(sessionId);
    return context.lastQuery?.objectLabel ?? null;
  }

  /**
   * Clear context for a session
   */
  clearContext(sessionId: string): void {
    this.contexts.delete(sessionId);
  }

  /**
   * Cleanup expired contexts (call periodically)
   */
  cleanupExpiredContexts(): void {
    const now = Date.now();
    
    for (const [sessionId, context] of this.contexts.entries()) {
      const lastActivity = context.history.length > 0 
        ? new Date(context.history[context.history.length - 1]!.timestamp).getTime()
        : 0;
      
      if (now - lastActivity > this.CONTEXT_EXPIRY_MS) {
        this.contexts.delete(sessionId);
      }
    }
  }

  /**
   * Get context summary for AI prompt
   */
  getContextSummary(sessionId: string): string {
    const context = this.getContext(sessionId);
    const parts: string[] = [];
    
    if (context.lastQuery) {
      parts.push(`Last query: ${context.lastQuery.action} on ${context.lastQuery.objectLabel}`);
      
      if (context.lastQuery.groupByField) {
        parts.push(`Grouped by: ${context.lastQuery.groupByDisplayName || context.lastQuery.groupByField}`);
        
        const options = this.getDrillDownOptions(sessionId);
        if (options.length > 0) {
          parts.push(`Available values: ${options.slice(0, 10).join(', ')}`);
        }
      }
      
      if (context.lastQuery.totalCount) {
        parts.push(`Total records: ${context.lastQuery.totalCount}`);
      }
    }
    
    if (context.currentPage) {
      parts.push(`Current page: ${context.currentPage.objectType}${context.currentPage.recordName ? ` - ${context.currentPage.recordName}` : ''}`);
    }
    
    // Add recent history summary
    if (context.history.length > 0) {
      const recentUserMessages = context.history
        .filter(t => t.role === 'user')
        .slice(-3)
        .map(t => t.message);
      
      if (recentUserMessages.length > 0) {
        parts.push(`Recent questions: ${recentUserMessages.join(' | ')}`);
      }
    }
    
    return parts.join('\n');
  }
}
