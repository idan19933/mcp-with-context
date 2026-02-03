/**
 * AI Middleware for Clarity PPM - UPGRADED VERSION
 * Features:
 * - Conversation Context (memory across messages)
 * - Drill-down from charts to filtered lists
 * - Smart suggestions
 * - Deep linking to Clarity
 * - Better error handling with fallbacks
 */

import Anthropic from '@anthropic-ai/sdk';
import type { ClarityApiClient } from './services/ClarityApiClient.js';
import type { MetadataService } from './services/MetadataService.js';
import type { LookupService } from './services/LookupService.js';
import type { ObjectMetadata } from './types/clarity.js';
import { ContextService } from './services/ContextService.js';
import { DeepLinkService } from './services/DeepLinkService.js';
import { SuggestionService, type Suggestion } from './services/SuggestionService.js';
import { detectFollowUpIntent } from './types/context.js';
import type { ConversationContext } from './types/context.js';
import { toolRegistry } from './tools/ToolRegistry.js';

// ============================================================================
// TYPES
// ============================================================================

interface AIResponse {
  success: boolean;
  reply: string;
  chartData: ChartData | null;
  timestamp: string;
  suggestions?: Array<{ label: string; value: string }>;
  deepLink?: string;
  debug?: {
    aiPlan?: string;
    apiCalls?: string[];
    context?: string;
  };
}

interface ChartData {
  groupableFields: string[];
  chartData: Record<string, Array<{ label: string; value: number }>>;
  fieldMetadata: Record<string, { displayName: string; dataType: string }>;
  // NEW: Support for different chart types
  chartType?: 'bar' | 'pie' | 'line' | 'doughnut' | 'horizontal-bar';
  // NEW: Drill-down info
  drillDownEnabled?: boolean;
  objectType?: string;
  groupByField?: string;
}

interface APIPlan {
  action: 'query' | 'create' | 'update' | 'delete' | 'analyze' | 'describe' | 'help' | 'drilldown';
  objectType: string;
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  endpoint: string;
  queryParams?: Record<string, string>;
  body?: Record<string, unknown>;
  groupByField?: string;
  filterField?: string;
  filterValue?: string;
  explanation: string;
}

// ============================================================================
// AI CHAT HANDLER
// ============================================================================

export class AIChatHandler {
  private anthropic: Anthropic;
  private client: ClarityApiClient;
  private metadataService: MetadataService;
  private contextService: ContextService;
  private deepLinkService: DeepLinkService;
  private suggestionService: SuggestionService;
  
  // Metadata cache
  private discoveredObjects: string[] = [];
  private metadataCache: Map<string, ObjectMetadata> = new Map();

  constructor(
    client: ClarityApiClient,
    metadataService: MetadataService,
    _lookupService: LookupService,
    clarityBaseUrl: string
  ) {
    this.anthropic = new Anthropic();
    this.client = client;
    this.metadataService = metadataService;
    this.contextService = new ContextService();
    this.deepLinkService = new DeepLinkService(clarityBaseUrl);
    this.suggestionService = new SuggestionService();
  }

  // ============================================================================
  // MAIN HANDLER
  // ============================================================================

  async handleMessage(message: string, sessionId: string = 'default'): Promise<AIResponse> {
    const timestamp = new Date().toISOString();
    const startTime = Date.now();
    
    try {
      console.log(`[AI] Processing: "${message}" (session: ${sessionId})`);
      
      // Get conversation context
      const context = this.contextService.getContext(sessionId);
      
      // Add user message to history
      this.contextService.addToHistory(sessionId, {
        timestamp,
        role: 'user',
        message,
      });
      
      // Step 1: Discover available objects if not cached
      if (this.discoveredObjects.length === 0) {
        await this.discoverObjects();
      }
      
      // Step 2: Quick check for greetings/help
      if (/^(hi|hello|hey|help|שלום|היי)[\s!.?]*$/i.test(message.trim())) {
        return this.getHelpResponse(timestamp);
      }
      
      // Step 3: Check for LINK requests FIRST (independent of drill-down context)
      const lowerMessage = message.toLowerCase();
      if (lowerMessage.includes('link') && !lowerMessage.includes('create') && !lowerMessage.includes('new')) {
        const linkResult = await this.handleLinkRequest(sessionId, timestamp, message);
        if (linkResult.success) {
          // Generate suggestions
          const suggestions = this.suggestionService.generateSuggestions(
            this.contextService.getContext(sessionId), 'query'
          );
          this.contextService.addToHistory(sessionId, {
            timestamp, role: 'assistant', message: linkResult.reply, action: 'link', success: true,
          });
          return { ...linkResult, suggestions: suggestions.map(s => ({ label: `${s.emoji} ${s.text}`, value: s.action })) };
        }
      }
      
      // Step 4: Check for follow-up intent (drill-down, export, count - NOT link)
      const followUp = detectFollowUpIntent(message);
      if (followUp.type && followUp.type !== 'link' && this.contextService.canDrillDown(sessionId)) {
        const followUpResult = await this.handleFollowUp(
          sessionId, 
          followUp.type, 
          followUp.extractedValue, 
          message,
          timestamp
        );
        if (followUpResult) {
          return followUpResult;
        }
      }
      
      // Step 5: Handle "custom objects" LIST/COUNT queries directly
      // But NOT "describe" queries - those should go to AI plan
      if (lowerMessage.includes('custom object') && 
          !lowerMessage.includes('create') && 
          !lowerMessage.includes('new') &&
          !lowerMessage.includes('add') &&
          !lowerMessage.includes('describe') &&
          !lowerMessage.includes('fields') &&
          !lowerMessage.includes('תאר') &&
          !lowerMessage.includes('שדות')) {
        return await this.handleCustomObjectsQuery(message, timestamp);
      }
      
      // Step 5: Use AI to understand the request and plan API calls
      const plan = await this.getAIPlan(message, context);
      console.log(`[AI] Plan:`, JSON.stringify(plan, null, 2));
      
      // Step 6: Execute the plan
      const result = await this.executePlan(plan, message, sessionId);
      
      // Step 7: Generate suggestions based on action
      const suggestions = this.suggestionService.generateSuggestions(
        this.contextService.getContext(sessionId),
        plan.action
      );
      
      // Add to history
      this.contextService.addToHistory(sessionId, {
        timestamp: new Date().toISOString(),
        role: 'assistant',
        message: result.reply.substring(0, 200),
        action: plan.action,
        objectType: plan.objectType,
        success: result.success,
      });
      
      const executionTime = Date.now() - startTime;
      console.log(`[AI] Completed in ${executionTime}ms`);
      
      return {
        ...result,
        timestamp,
        suggestions: this.suggestionService.formatSuggestionsAsButtons(suggestions),
        debug: {
          aiPlan: plan.explanation,
          apiCalls: [plan.endpoint],
          context: this.contextService.getContextSummary(sessionId),
        },
      };
      
    } catch (error) {
      console.error('[AI] Error:', error);
      return this.getErrorResponse(error, timestamp, sessionId);
    }
  }

  // ============================================================================
  // FOLLOW-UP HANDLER (Drill-down, Export, etc.)
  // ============================================================================

  private async handleFollowUp(
    sessionId: string,
    intentType: string,
    extractedValue: string | undefined,
    originalMessage: string,
    timestamp: string
  ): Promise<AIResponse | null> {
    const context = this.contextService.getContext(sessionId);
    
    switch (intentType) {
      case 'showSelected':
        return this.handleDrillDown(sessionId, extractedValue, originalMessage, timestamp);
      
      case 'link':
        return this.handleLinkRequest(sessionId, timestamp, originalMessage);
      
      case 'count':
        return this.handleCountFollowUp(sessionId, timestamp);
      
      case 'export':
        // Export functionality - could be implemented later
        return {
          success: true,
          reply: `📥 **Export Feature**\n\nExport functionality is coming soon! For now, you can:\n• Copy the data from above\n• Use the deep link to open in Clarity and export from there`,
          chartData: null,
          timestamp,
        };
      
      default:
        return null; // Let the normal flow handle it
    }
  }

  // ============================================================================
  // DRILL-DOWN HANDLER
  // ============================================================================

  private async handleDrillDown(
    sessionId: string,
    extractedValue: string | undefined,
    originalMessage: string,
    timestamp: string
  ): Promise<AIResponse | null> {
    const context = this.contextService.getContext(sessionId);
    
    if (!context.lastQuery?.groupByField || !context.lastQuery?.objectType) {
      return null;
    }
    
    // Try to find the matching value
    let matchedValue: string | null = null;
    
    if (extractedValue) {
      matchedValue = this.contextService.findDrillDownMatch(sessionId, extractedValue);
    }
    
    // If no match found, try to extract from message more aggressively
    if (!matchedValue) {
      const availableOptions = this.contextService.getDrillDownOptions(sessionId);
      for (const option of availableOptions) {
        if (originalMessage.toLowerCase().includes(option.toLowerCase())) {
          matchedValue = option;
          break;
        }
      }
    }
    
    if (!matchedValue) {
      // Couldn't find a match - show available options
      const options = this.contextService.getDrillDownOptions(sessionId);
      return {
        success: false,
        reply: `❓ I couldn't determine which value you want to see.\n\n**Available options from the last chart:**\n${options.map(o => `• "${o}"`).join('\n')}\n\nPlease specify one of these values.`,
        chartData: null,
        timestamp,
      };
    }
    
    // Execute drill-down
    const objectType = context.lastQuery.objectType;
    const objectLabel = context.lastQuery.objectLabel;
    const groupByField = context.lastQuery.groupByField;
    const groupByDisplayName = context.lastQuery.groupByDisplayName || groupByField;
    
    console.log(`[AI] Drill-down: ${objectType} where ${groupByField} = "${matchedValue}"`);
    
    try {
      // Build filter - handle lookup fields vs simple values
      let filterValue = matchedValue;
      if (matchedValue === '(No value)') {
        // Can't filter by null easily, just get all and filter client-side
        // Or use special API syntax if available
      }
      
      const endpoint = `/${objectType}?filter=((${groupByField} = '${filterValue}'))&fields=_internalId,name,code,status&limit=50`;
      
      const response = await this.client.get<Record<string, unknown>>(endpoint);
      const records = (response._results ?? []) as Array<Record<string, unknown>>;
      const totalCount = (response._totalCount as number) ?? records.length;
      
      // Generate deep link
      const deepLink = this.deepLinkService.generateFilteredLink(
        objectType,
        groupByField,
        matchedValue
      );
      
      // Format response
      let reply = `🔍 **${objectLabel} where ${groupByDisplayName} = "${matchedValue}"**\n`;
      reply += `Found **${totalCount}** records\n\n`;
      
      for (const record of records.slice(0, 15)) {
        const name = record['name'] ?? record['code'] ?? record['_internalId'];
        const status = this.formatFieldValue(record['status']);
        reply += `• **${name}**`;
        if (status) reply += ` (${status})`;
        reply += '\n';
      }
      
      if (totalCount > 15) {
        reply += `\n_...and ${totalCount - 15} more_`;
      }
      
      reply += `\n\n🔗 [Open in Clarity](${deepLink})`;
      
      // Update context with drill-down results
      this.contextService.updateLastQuery(sessionId, {
        objectType,
        objectLabel: objectLabel ?? objectType,
        action: 'drilldown',
        filters: { [groupByField]: matchedValue },
        results: records,
        totalCount,
        timestamp: new Date().toISOString(),
      });
      
      return {
        success: true,
        reply,
        chartData: null,
        timestamp,
        deepLink,
      };
      
    } catch (error) {
      console.error('[AI] Drill-down error:', error);
      return {
        success: false,
        reply: `❌ Could not retrieve ${objectLabel} where ${groupByDisplayName} = "${matchedValue}".\n\nError: ${error instanceof Error ? error.message : String(error)}`,
        chartData: null,
        timestamp,
      };
    }
  }

  // ============================================================================
  // LINK REQUEST HANDLER
  // ============================================================================

  private async handleLinkRequest(sessionId: string, timestamp: string, originalMessage?: string): Promise<AIResponse> {
    const context = this.contextService.getContext(sessionId);
    
    if (!originalMessage) {
      // No message - use last query context
      return this.generateContextLink(context, timestamp);
    }
    
    const msg = originalMessage.toLowerCase().trim();
    
    // Known standard object types
    const STANDARD_OBJECTS = ['projects', 'tasks', 'resources', 'ideas', 'risks', 'issues', 'timesheets'];
    
    // Pattern 1: "link to all projects" / "link to projects" / "link to all tasks"
    const allObjectMatch = msg.match(/link\s+(?:to\s+)?(?:all\s+)?(projects|tasks|resources|ideas|risks|issues|timesheets)\b/i);
    if (allObjectMatch) {
      const objectName = allObjectMatch[1].toLowerCase();
      const deepLink = this.deepLinkService.generateListLink(objectName);
      return {
        success: true,
        reply: `🔗 **All ${objectName.charAt(0).toUpperCase() + objectName.slice(1)}**\n\n${deepLink}`,
        chartData: null,
        timestamp,
        deepLink,
      };
    }
    
    // Pattern 2: "link to custom objects"
    if (msg.includes('custom object')) {
      const customObjects = await this.metadataService.getCustomObjects();
      const links = customObjects.slice(0, 5).map(obj => 
        `• ${obj.label}: ${this.deepLinkService.generateListLink(obj.resourceName)}`
      ).join('\n');
      return {
        success: true,
        reply: `🔗 **Custom Objects Links**\n\n${links}${customObjects.length > 5 ? `\n\n...and ${customObjects.length - 5} more` : ''}`,
        chartData: null,
        timestamp,
      };
    }
    
    // Pattern 3: "link to project X" / "link to X project" / "link to idanTest3"
    // Extract the record name - remove known keywords
    const linkToMatch = msg.match(/link\s+(?:to\s+)(?:project\s+)?["']?(.+?)["']?(?:\s+project)?$/i);
    if (linkToMatch) {
      let recordName = linkToMatch[1]?.trim();
      
      // Remove trailing "project" / "projectr" if present
      recordName = recordName.replace(/\s*projects?\s*$/i, '').trim();
      
      // Skip generic words
      if (recordName && !['this', 'them', 'it', 'all', 'the', 'that'].includes(recordName)) {
        
        // Check if it's a custom object code/name
        const customObjects = await this.metadataService.getCustomObjects();
        const customObj = customObjects.find(o => 
          o.label.toLowerCase().includes(recordName) || 
          o.resourceName.toLowerCase().includes(recordName)
        );
        
        if (customObj) {
          const deepLink = this.deepLinkService.generateListLink(customObj.resourceName);
          return {
            success: true,
            reply: `🔗 **${customObj.label}**\n\n${deepLink}`,
            chartData: null,
            timestamp,
            deepLink,
          };
        }
        
        // Try to find as a project record
        const record = await this.findRecordByName('projects', recordName);
        
        if (record) {
          const deepLink = this.deepLinkService.generateRecordLink('projects', record._internalId, 'properties');
          return {
            success: true,
            reply: `🔗 **Project "${record.name || recordName}"**\n\n${deepLink}`,
            chartData: null,
            timestamp,
            deepLink,
          };
        }
        
        return {
          success: false,
          reply: `❌ Could not find "${recordName}". Check the name and try again.\n\nTry:\n• "Give me link to all projects"\n• "Give me link to project [exact name]"`,
          chartData: null,
          timestamp,
        };
      }
    }
    
    // Fall back to last query context
    return this.generateContextLink(context, timestamp);
  }

  /**
   * Generate a link based on the last query context
   */
  private generateContextLink(context: ConversationContext, timestamp: string): AIResponse {
    if (!context.lastQuery?.objectType) {
      return {
        success: false,
        reply: `❓ I need to know what to link to.\n\nTry:\n• "Give me link to all projects"\n• "Give me link to project [name]"\n• "Give me link to custom objects"`,
        chartData: null,
        timestamp,
      };
    }
    
    const { objectType, objectLabel, filters } = context.lastQuery;
    
    let deepLink: string;
    let linkDescription: string;
    
    if (filters && Object.keys(filters).length > 0) {
      deepLink = this.deepLinkService.generateMultiFilterLink(objectType, filters);
      const filterDesc = Object.entries(filters).map(([k, v]) => `${k}="${v}"`).join(', ');
      linkDescription = `${objectLabel} filtered by ${filterDesc}`;
    } else {
      deepLink = this.deepLinkService.generateListLink(objectType);
      linkDescription = `All ${objectLabel}`;
    }
    
    return {
      success: true,
      reply: `🔗 **Link to Clarity**\n\n${linkDescription}:\n${deepLink}`,
      chartData: null,
      timestamp,
      deepLink,
    };
  }

  /**
   * Find a record by name or code (without using unsupported fields)
   */
  private async findRecordByName(
    objectType: string,
    nameOrCode: string
  ): Promise<{ _internalId: number; name?: string; code?: string } | null> {
    try {
      // Escape special characters for filter
      const escapedName = nameOrCode.replace(/'/g, "''");
      
      // Try to find by code first (exact match)
      let response = await this.client.get<Record<string, unknown>>(
        `/${objectType}?filter=((code = '${escapedName}'))&fields=_internalId,name,code&limit=1`
      );
      
      let records = (response._results ?? []) as Array<Record<string, unknown>>;
      
      if (records.length === 0) {
        // Try to find by name (contains)
        response = await this.client.get<Record<string, unknown>>(
          `/${objectType}?filter=((name contains '${escapedName}'))&fields=_internalId,name,code&limit=1`
        );
        records = (response._results ?? []) as Array<Record<string, unknown>>;
      }
      
      if (records.length === 0) return null;
      
      return {
        _internalId: records[0]?.['_internalId'] as number,
        name: records[0]?.['name'] as string | undefined,
        code: records[0]?.['code'] as string | undefined,
      };
    } catch (error) {
      console.error('[AI] findRecordByName error:', error);
      return null;
    }
  }

  // ============================================================================
  // COUNT FOLLOW-UP HANDLER
  // ============================================================================

  private async handleCountFollowUp(sessionId: string, timestamp: string): Promise<AIResponse> {
    const context = this.contextService.getContext(sessionId);
    
    if (context.lastQuery?.totalCount !== undefined) {
      return {
        success: true,
        reply: `🔢 **Total: ${context.lastQuery.totalCount} ${context.lastQuery.objectLabel}**`,
        chartData: null,
        timestamp,
      };
    }
    
    return {
      success: false,
      reply: `❓ I don't have a count from a previous query. Please run a query first.`,
      chartData: null,
      timestamp,
    };
  }

  // ============================================================================
  // ERROR RESPONSE WITH SUGGESTIONS
  // ============================================================================

  private getErrorResponse(error: unknown, timestamp: string, sessionId: string): AIResponse {
    const errorMessage = error instanceof Error ? error.message : String(error);
    
    // Determine helpful suggestions based on error type
    let suggestions: string[] = [];
    let hint = '';
    
    if (errorMessage.includes('404') || errorMessage.includes('not found')) {
      suggestions = [
        'List all available objects',
        'Show custom objects',
        'Describe projects',
      ];
      hint = 'The object or field might not exist.';
    } else if (errorMessage.includes('401') || errorMessage.includes('403') || errorMessage.includes('auth')) {
      suggestions = [
        'Check API credentials',
        'Verify permissions',
      ];
      hint = 'There might be an authentication or permission issue.';
    } else if (errorMessage.includes('timeout') || errorMessage.includes('ECONNREFUSED')) {
      suggestions = [
        'Try again in a moment',
        'Check Clarity server status',
      ];
      hint = 'The Clarity server might be temporarily unavailable.';
    } else {
      suggestions = [
        'Try a simpler query',
        'List projects',
        'Show custom objects',
      ];
    }
    
    let reply = `❌ **Something went wrong**\n\n`;
    reply += `${hint}\n\n`;
    reply += `**Error:** ${errorMessage.substring(0, 200)}\n\n`;
    reply += `💡 **Try instead:**\n`;
    reply += suggestions.map(s => `• "${s}"`).join('\n');
    
    return {
      success: false,
      reply,
      chartData: null,
      timestamp,
    };
  }

  // ============================================================================
  // OBJECT DISCOVERY
  // ============================================================================

  private async discoverObjects(): Promise<void> {
    console.log('[AI] Discovering objects...');
    this.discoveredObjects = await this.metadataService.discoverAllObjects();
    console.log(`[AI] Discovered ${this.discoveredObjects.length} objects`);
  }

  private async getObjectMetadata(objectType: string): Promise<ObjectMetadata> {
    if (!this.metadataCache.has(objectType)) {
      const metadata = await this.metadataService.getObjectMetadata(objectType);
      this.metadataCache.set(objectType, metadata);
    }
    return this.metadataCache.get(objectType)!;
  }

  // ============================================================================
  // DETECT TARGET OBJECT FROM MESSAGE
  // ============================================================================

  private async detectTargetObject(message: string, sessionId: string = 'default'): Promise<{ objectType: string; label: string } | null> {
    const lowerMessage = message.toLowerCase();
    const customObjects = await this.metadataService.getCustomObjects();
    
    // Check custom objects first (by label or resourceName)
    for (const obj of customObjects) {
      const labelLower = obj.label.toLowerCase();
      const resourceLower = obj.resourceName.toLowerCase();
      
      if (lowerMessage.includes(labelLower) || lowerMessage.includes(resourceLower)) {
        console.log(`[AI] Detected custom object: ${obj.label} (${obj.resourceName})`);
        return { objectType: obj.resourceName, label: obj.label };
      }
    }
    
    // Check standard objects
    const standardObjects = ['projects', 'tasks', 'resources', 'ideas', 'risks', 'issues', 'timesheets'];
    for (const obj of standardObjects) {
      if (lowerMessage.includes(obj) || lowerMessage.includes(obj.slice(0, -1))) {
        return { objectType: obj, label: obj.charAt(0).toUpperCase() + obj.slice(1) };
      }
    }
    
    // Check for context-based references like "the object", "this", "it", "האובייקט", "עליו"
    const contextTriggers = [
      'the object', 'this object', 'that object', 'it', 'this', 'האובייקט', 
      'עליו', 'אותו', 'הזה', 'עוד נתונים', 'more data', 'more info', 'עוד מידע',
      'describe', 'fields', 'שדות', 'תאר'
    ];
    
    const hasContextReference = contextTriggers.some(trigger => lowerMessage.includes(trigger));
    
    // If message seems to reference previous context OR no object found, use last queried object
    if (hasContextReference || !this.hasObjectMention(lowerMessage, customObjects)) {
      const context = this.contextService.getContext(sessionId);
      if (context.lastQuery?.objectType && context.lastQuery?.objectLabel) {
        console.log(`[AI] Using context object: ${context.lastQuery.objectLabel} (${context.lastQuery.objectType})`);
        return { 
          objectType: context.lastQuery.objectType, 
          label: context.lastQuery.objectLabel 
        };
      }
    }
    
    // Default to projects if no match and no context
    return { objectType: 'projects', label: 'Projects' };
  }

  // Helper to check if message mentions any object
  private hasObjectMention(message: string, customObjects: Array<{ label: string; resourceName: string }>): boolean {
    const standardObjects = ['projects', 'tasks', 'resources', 'ideas', 'risks', 'issues', 'timesheets', 
                            'project', 'task', 'resource', 'idea', 'risk', 'issue', 'timesheet'];
    
    // Check standard objects
    for (const obj of standardObjects) {
      if (message.includes(obj)) return true;
    }
    
    // Check custom objects
    for (const obj of customObjects) {
      if (message.includes(obj.label.toLowerCase()) || message.includes(obj.resourceName.toLowerCase())) {
        return true;
      }
    }
    
    return false;
  }

  // ============================================================================
  // CUSTOM OBJECTS HANDLER (bypasses AI)
  // ============================================================================

  private async handleCustomObjectsQuery(message: string, timestamp: string): Promise<AIResponse> {
    const lowerMessage = message.toLowerCase();
    const customObjects = await this.metadataService.getCustomObjects();
    
    // Count query - how many custom object TYPES
    if ((lowerMessage.includes('how many') || lowerMessage.includes('count')) && 
        !lowerMessage.includes('instance') && !lowerMessage.includes('record') && !lowerMessage.includes('most')) {
      return {
        success: true,
        reply: `📊 **Found ${customObjects.length} Custom Objects** in the system`,
        chartData: null,
        timestamp,
      };
    }
    
    // Check if user wants instance counts
    const wantsInstanceCount = lowerMessage.includes('most') || 
                               lowerMessage.includes('instance') || 
                               lowerMessage.includes('record') ||
                               lowerMessage.includes('top') ||
                               /\d+/.test(lowerMessage);
    
    if (wantsInstanceCount) {
      const limitMatch = lowerMessage.match(/(\d+)/);
      const limit = limitMatch && limitMatch[1] ? Math.min(parseInt(limitMatch[1]), customObjects.length) : 10;
      
      const objectCounts: Array<{ label: string; resourceName: string; count: number }> = [];
      
      for (const obj of customObjects) {
        try {
          const response = await this.client.get<Record<string, unknown>>(
            `/${obj.resourceName}?fields=_internalId&limit=1`
          );
          const count = (response._totalCount as number) ?? 0;
          objectCounts.push({ label: obj.label, resourceName: obj.resourceName, count });
        } catch {
          objectCounts.push({ label: obj.label, resourceName: obj.resourceName, count: 0 });
        }
      }
      
      objectCounts.sort((a, b) => b.count - a.count);
      
      let reply = `📊 **Top ${limit} Custom Objects by Instance Count**\n\n`;
      
      for (let i = 0; i < Math.min(limit, objectCounts.length); i++) {
        const obj = objectCounts[i];
        if (!obj) continue;
        reply += `${i + 1}. **${obj.label}** (\`${obj.resourceName}\`) - **${obj.count}** records\n`;
      }
      
      const totalInstances = objectCounts.reduce((sum, o) => sum + o.count, 0);
      reply += `\n📈 **Total:** ${totalInstances} records across ${customObjects.length} custom objects`;
      
      return {
        success: true,
        reply,
        chartData: null,
        timestamp,
      };
    }
    
    // Simple list query
    let reply = `📋 **Custom Objects (${customObjects.length})**\n\n`;
    
    for (const obj of customObjects) {
      reply += `• **${obj.label}** (\`${obj.resourceName}\`)\n`;
    }
    
    reply += `\n💡 To query a custom object, try: "list ${customObjects[0]?.resourceName ?? 'custXXX'}"`;
    
    return {
      success: true,
      reply,
      chartData: null,
      timestamp,
    };
  }

  // ============================================================================
  // AI PLANNING (with context)
  // ============================================================================

  private async getAIPlan(userMessage: string, context: ConversationContext): Promise<APIPlan> {
    // Detect target object - pass sessionId for context awareness
    const targetObject = await this.detectTargetObject(userMessage, context.sessionId);
    const objectType = targetObject?.objectType ?? 'projects';
    const objectLabel = targetObject?.label ?? 'Projects';
    
    console.log(`[AI] Target object: ${objectLabel} (${objectType})`);
    
    // Get metadata for the target object
    const targetMetadata = await this.getObjectMetadata(objectType);
    const customObjects = await this.metadataService.getCustomObjects();
    
    // Build context about available objects and fields
    const objectList = this.discoveredObjects.slice(0, 50).join(', ');
    const customObjectList = customObjects.map(o => `${o.label} (${o.resourceName})`).join(', ');
    
    // PRE-PROCESS: Find field matches in user's message
    const userLower = userMessage.toLowerCase();
    let resolvedFieldHint = '';
    let foundFieldApiName = '';
    
    for (const attr of targetMetadata.attributes) {
      const displayLower = attr.displayName.toLowerCase();
      const apiLower = attr.apiName.toLowerCase();
      
      if (userMessage.includes(attr.displayName) || userLower.includes(displayLower) || userLower.includes(apiLower)) {
        resolvedFieldHint = `\n\n🎯 FIELD MATCH FOUND: User mentioned "${attr.displayName}" which maps to apiName "${attr.apiName}" (${attr.dataType}). YOU MUST USE THIS EXACT APINAME: "${attr.apiName}"!`;
        foundFieldApiName = attr.apiName;
        console.log(`[AI] Field match: "${attr.displayName}" → "${attr.apiName}"`);
        break;
      }
    }
    
    // Get groupable fields
    const groupableFields = this.metadataService.getGroupableFields(targetMetadata);
    const groupableList = groupableFields
      .slice(0, 50)
      .map(a => `"${a.apiName}" (${a.displayName})`)
      .join(', ');
    
    // Get ALL fields mapping
    const allFieldMappings = targetMetadata.attributes
      .filter(a => !a.apiName.startsWith('_') || a.apiName === '_internalId')
      .map(a => `"${a.displayName}" → "${a.apiName}"`)
      .join('\n    ');

    // Add context summary to prompt
    const contextSummary = this.contextService.getContextSummary(context.sessionId);

    const systemPrompt = `You are a Clarity PPM API expert. Your job is to understand user requests and create the correct REST API plan.

CONVERSATION CONTEXT:
${contextSummary || 'No previous context'}

DETECTED TARGET OBJECT: ${objectLabel} (${objectType})

CRITICAL RULES:
1. ALWAYS use apiName (not displayName) in endpoints and groupByField
2. The user is asking about: ${objectLabel} (${objectType})
3. If user mentions a field by display name, find the apiName from the mapping below
4. Hebrew display names are common - always map them to their apiName
${resolvedFieldHint}
${foundFieldApiName ? `5. USE THIS EXACT FIELD: "${foundFieldApiName}"` : ''}

AVAILABLE OBJECTS: ${objectList}

CUSTOM OBJECTS: ${customObjectList}

FIELDS FOR "${objectLabel}" (${objectType}):
GROUPABLE FIELDS: ${groupableList}

FIELD MAPPINGS (displayName → apiName):
    ${allFieldMappings}

CLARITY REST API RULES:
1. Base endpoints: /{objectType}
2. TASKS ARE CHILD OF PROJECTS: /projects/{projectId}/tasks
3. Filter syntax: filter=((field = 'value'))
4. Supported operators: =, !=, >, <, >=, <=, in, notIn (NO 'like'!)
5. MAXIMUM LIMIT IS 500!
6. For counting: use limit=1 and read _totalCount
7. Fields selection: fields=field1,field2,field3

RESPONSE FORMAT - Return ONLY valid JSON:
{
  "action": "query|create|update|delete|analyze|describe|help|drilldown",
  "objectType": "${objectType}",
  "method": "GET|POST|PATCH|DELETE",
  "endpoint": "the full endpoint path",
  "groupByField": "${foundFieldApiName || 'field to group by'}",
  "filterField": "field to filter by (for drilldown)",
  "filterValue": "value to filter by (for drilldown)",
  "explanation": "brief explanation"
}`;

    const response = await this.anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1024,
      system: systemPrompt,
      messages: [
        {
          role: 'user',
          content: `User request: "${userMessage}"\n\nReturn ONLY the JSON plan.`,
        },
      ],
    });

    const content = response.content[0];
    if (!content || content.type !== 'text') {
      throw new Error('Unexpected response type from AI');
    }

    const jsonMatch = content.text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('Could not parse AI response as JSON');
    }

    const plan = JSON.parse(jsonMatch[0]) as APIPlan;
    
    // Force field if we found a match
    if (foundFieldApiName && plan.action === 'analyze') {
      plan.groupByField = foundFieldApiName;
    }

    return plan;
  }

  // ============================================================================
  // PLAN EXECUTION
  // ============================================================================

  private async executePlan(
    plan: APIPlan, 
    originalMessage: string,
    sessionId: string
  ): Promise<Omit<AIResponse, 'timestamp' | 'debug' | 'suggestions'>> {
    switch (plan.action) {
      case 'help':
        return this.getHelpResponse('').then(r => ({ success: r.success, reply: r.reply, chartData: r.chartData }));
      
      case 'describe':
        return this.executeDescribe(plan);
      
      case 'query':
        return this.executeQuery(plan, originalMessage, sessionId);
      
      case 'analyze':
        return this.executeAnalyze(plan, sessionId);
      
      case 'create':
        return this.executeCreate(plan, originalMessage);
      
      case 'update':
        return this.executeUpdate(plan, originalMessage);
      
      case 'delete':
        return this.executeDelete(plan, originalMessage);
      
      default:
        return {
          success: false,
          reply: `❌ Unknown action: ${plan.action}`,
          chartData: null,
        };
    }
  }

  private async executeDescribe(plan: APIPlan): Promise<Omit<AIResponse, 'timestamp' | 'debug' | 'suggestions'>> {
    const metadata = await this.getObjectMetadata(plan.objectType);
    const groupableFields = this.metadataService.getGroupableFields(metadata);
    const lookupFields = metadata.attributes.filter(a => a.isLookup);

    let reply = `📋 **${metadata.label}** (\`${metadata.resourceName}\`)\n\n`;
    reply += `**Total Fields:** ${metadata.attributes.length}\n`;
    reply += `**Groupable Fields:** ${groupableFields.length}\n`;
    reply += `**Lookup Fields:** ${lookupFields.length}\n\n`;

    reply += `**Key Fields:**\n`;
    const keyFields = metadata.attributes
      .filter(a => !a.apiName.startsWith('_') || a.apiName === '_internalId')
      .slice(0, 15);
    
    for (const field of keyFields) {
      reply += `• **${field.displayName}** (\`${field.apiName}\`) - ${field.dataType}`;
      if (field.isLookup) reply += ' 🔗';
      reply += '\n';
    }

    return { success: true, reply, chartData: null };
  }

  private async executeQuery(
    plan: APIPlan, 
    originalMessage: string,
    sessionId: string
  ): Promise<Omit<AIResponse, 'timestamp' | 'debug' | 'suggestions'>> {
    let endpoint = plan.endpoint;
    
    // Ensure limit never exceeds 500
    endpoint = endpoint.replace(/limit=\d+/, (match) => {
      const limit = parseInt(match.split('=')[1] ?? '500');
      return `limit=${Math.min(limit, 500)}`;
    });
    
    // Handle project lookup for child objects
    if (endpoint.includes('{projectId}')) {
      const projectName = this.extractProjectName(originalMessage);
      if (projectName) {
        const project = await this.findRecord('projects', projectName);
        if (project) {
          endpoint = endpoint.replace('{projectId}', String(project._internalId));
        } else {
          return { success: false, reply: `❌ Could not find project "${projectName}"`, chartData: null };
        }
      } else {
        return { success: false, reply: `❌ Please specify a project name`, chartData: null };
      }
    }

    try {
      const response = await this.client.get<Record<string, unknown>>(endpoint);
      const records = (response._results ?? []) as Array<Record<string, unknown>>;
      const totalCount = (response._totalCount as number) ?? records.length;

      // Update context
      const label = await this.metadataService.getObjectLabel(plan.objectType);
      this.contextService.updateLastQuery(sessionId, {
        objectType: plan.objectType,
        objectLabel: label,
        action: 'query',
        results: records,
        totalCount,
        timestamp: new Date().toISOString(),
      });

      // Check if count query
      if (endpoint.includes('limit=1') && !endpoint.includes('limit=10')) {
        const projectName = this.extractProjectName(originalMessage);
        const contextStr = projectName ? ` in project "${projectName}"` : '';
        
        return {
          success: true,
          reply: `📊 **Found ${totalCount} ${label}**${contextStr}`,
          chartData: null,
        };
      }

      // Format as list
      let reply = `✅ **${totalCount} ${label}**\n\n`;

      for (const record of records.slice(0, 15)) {
        const name = record['name'] ?? record['code'] ?? record['_internalId'];
        const status = this.formatFieldValue(record['status']);
        reply += `• **${name}**`;
        if (status) reply += ` (${status})`;
        reply += '\n';
      }

      if (totalCount > 15) {
        reply += `\n_...and ${totalCount - 15} more_`;
      }

      return { success: true, reply, chartData: null };
      
    } catch (error) {
      return {
        success: false,
        reply: `❌ Query failed: ${error instanceof Error ? error.message : String(error)}`,
        chartData: null,
      };
    }
  }

  private async executeAnalyze(
    plan: APIPlan,
    sessionId: string
  ): Promise<Omit<AIResponse, 'timestamp' | 'debug' | 'suggestions'>> {
    const groupByField = plan.groupByField ?? 'status';
    const metadata = await this.getObjectMetadata(plan.objectType);
    
    // Validate field
    let actualFieldName = groupByField;
    const fieldMeta = metadata.attributes.find(a => 
      a.apiName.toLowerCase() === groupByField.toLowerCase() ||
      a.displayName.toLowerCase() === groupByField.toLowerCase()
    );
    
    if (!fieldMeta) {
      const groupableFields = this.metadataService.getGroupableFields(metadata);
      const suggestions = groupableFields
        .slice(0, 15)
        .map(f => `\`${f.apiName}\` (${f.displayName})`)
        .join('\n• ');
      
      return {
        success: false,
        reply: `❌ Field "${groupByField}" not found in ${metadata.label}.\n\n**Available fields:**\n• ${suggestions}`,
        chartData: null,
      };
    }
    
    actualFieldName = fieldMeta.apiName;
    const endpoint = `/${plan.objectType}?fields=_internalId,${actualFieldName}&limit=500`;

    try {
      const response = await this.client.get<Record<string, unknown>>(endpoint);
      const records = (response._results ?? []) as Array<Record<string, unknown>>;

      // Build distribution
      const distribution = new Map<string, number>();
      for (const record of records) {
        const rawValue = record[actualFieldName];
        const displayValue = this.formatFieldValue(rawValue) || '(No value)';
        distribution.set(displayValue, (distribution.get(displayValue) ?? 0) + 1);
      }

      const chartDataArray = Array.from(distribution.entries())
        .map(([label, value]) => ({ label, value }))
        .sort((a, b) => b.value - a.value);

      const label = await this.metadataService.getObjectLabel(plan.objectType);
      const fieldDisplayName = fieldMeta.displayName;

      // Update context with chart data
      this.contextService.updateLastQuery(sessionId, {
        objectType: plan.objectType,
        objectLabel: label,
        action: 'analyze',
        totalCount: records.length,
        groupByField: actualFieldName,
        groupByDisplayName: fieldDisplayName,
        chartData: { [actualFieldName]: chartDataArray },
        timestamp: new Date().toISOString(),
      });

      let reply = `📊 **${label} by ${fieldDisplayName}** (${records.length} records)\n\n`;
      for (const item of chartDataArray.slice(0, 10)) {
        const pct = ((item.value / records.length) * 100).toFixed(1);
        reply += `• **${item.label}:** ${item.value} (${pct}%)\n`;
      }

      if (chartDataArray.length > 10) {
        reply += `\n_...and ${chartDataArray.length - 10} more categories_`;
      }

      reply += `\n\n✨ Click on any value to see the records`;

      const chartData: ChartData = {
        groupableFields: [actualFieldName],
        chartData: { [actualFieldName]: chartDataArray },
        fieldMetadata: {
          [actualFieldName]: {
            displayName: fieldDisplayName,
            dataType: fieldMeta.dataType ?? 'string',
          },
        },
        drillDownEnabled: true,
        objectType: plan.objectType,
        groupByField: actualFieldName,
      };

      return { success: true, reply, chartData };
      
    } catch (error) {
      const groupableFields = this.metadataService.getGroupableFields(metadata);
      const suggestions = groupableFields
        .slice(0, 10)
        .map(f => `\`${f.apiName}\``)
        .join(', ');
      
      return {
        success: false,
        reply: `❌ Could not query field "${actualFieldName}".\n\n**Try:** ${suggestions}`,
        chartData: null,
      };
    }
  }

  private async executeCreate(plan: APIPlan, originalMessage: string): Promise<Omit<AIResponse, 'timestamp' | 'debug' | 'suggestions'>> {
    let endpoint = plan.endpoint;
    let body = plan.body ?? {};

    if (endpoint.includes('/projects/') && !/\/projects\/\d+/.test(endpoint)) {
      const projectName = this.extractProjectName(originalMessage);
      if (projectName) {
        const project = await this.findRecord('projects', projectName);
        if (project) {
          endpoint = endpoint.replace(/\/projects\/[^/]+\//, `/projects/${project._internalId}/`);
        } else {
          return { success: false, reply: `❌ Could not find project "${projectName}"`, chartData: null };
        }
      }
    }

    if (!body['name']) {
      const nameMatch = originalMessage.match(/(?:named?|called)\s+["']?([^"']+?)["']?(?:\s+in|\s+for|$)/i);
      if (nameMatch) {
        body['name'] = nameMatch[1]?.trim();
      }
    }

    if (!body['code'] && (endpoint === '/projects' || /^\/cust|^\/oba/.test(endpoint))) {
      const name = body['name'] as string;
      if (name) {
        body['code'] = name.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase() + '_' + Date.now();
      }
    }

    const result = await this.client.post(endpoint, body);
    const newId = result._internalId;
    const label = await this.metadataService.getObjectLabel(plan.objectType);

    return {
      success: true,
      reply: `✅ **${label} Created!**\n\n• **Name:** ${body['name']}\n• **ID:** ${newId}`,
      chartData: null,
    };
  }

  private async executeUpdate(plan: APIPlan, originalMessage: string): Promise<Omit<AIResponse, 'timestamp' | 'debug' | 'suggestions'>> {
    const recordName = this.extractRecordName(originalMessage);
    if (!recordName) {
      return { success: false, reply: '❌ Could not determine which record to update', chartData: null };
    }

    const record = await this.findRecord(plan.objectType, recordName);
    if (!record) {
      return { success: false, reply: `❌ Could not find ${plan.objectType} "${recordName}"`, chartData: null };
    }

    const endpoint = `/${plan.objectType}/${record._internalId}`;
    await this.client.patch(endpoint, plan.body ?? {});

    const label = await this.metadataService.getObjectLabel(plan.objectType);
    return {
      success: true,
      reply: `✅ **${label} Updated!**\n\n• **Record:** ${record.name ?? recordName}`,
      chartData: null,
    };
  }

  private async executeDelete(plan: APIPlan, originalMessage: string): Promise<Omit<AIResponse, 'timestamp' | 'debug' | 'suggestions'>> {
    const recordName = this.extractRecordName(originalMessage);
    if (!recordName) {
      return { success: false, reply: '❌ Could not determine which record to delete', chartData: null };
    }

    const record = await this.findRecord(plan.objectType, recordName);
    if (!record) {
      return { success: false, reply: `❌ Could not find ${plan.objectType} "${recordName}"`, chartData: null };
    }

    const endpoint = `/${plan.objectType}/${record._internalId}`;
    await this.client.delete(endpoint);

    const label = await this.metadataService.getObjectLabel(plan.objectType);
    return {
      success: true,
      reply: `✅ **${label} Deleted!**\n\n• **ID:** ${record._internalId}`,
      chartData: null,
    };
  }

  // ============================================================================
  // HELPER METHODS
  // ============================================================================

  private async findRecord(
    objectType: string,
    nameOrCode: string
  ): Promise<{ _internalId: number; name?: string } | null> {
    try {
      const response = await this.client.get<Record<string, unknown>>(
        `/${objectType}?filter=((code = '${nameOrCode}') or (name = '${nameOrCode}'))&fields=_internalId,name&limit=1`
      );
      const records = (response._results ?? []) as Array<Record<string, unknown>>;
      if (records.length === 0) return null;
      return {
        _internalId: records[0]?.['_internalId'] as number,
        name: records[0]?.['name'] as string | undefined,
      };
    } catch {
      return null;
    }
  }

  private extractProjectName(message: string): string | null {
    const match = message.match(/(?:in|for|of|under)\s+(?:project\s+)?["']?([a-zA-Z0-9_-]+)["']?/i);
    return match?.[1] ?? null;
  }

  private extractRecordName(message: string): string | null {
    const match = message.match(/(?:named?|called|project|task|record)\s+["']?([^"']+?)["']?(?:\s+set|\s+to|$)/i);
    return match?.[1]?.trim() ?? null;
  }

  private formatFieldValue(value: unknown): string {
    if (value === null || value === undefined) return '';
    if (typeof value === 'object') {
      const obj = value as Record<string, unknown>;
      return (obj['displayValue'] as string) ?? (obj['code'] as string) ?? JSON.stringify(value);
    }
    return String(value);
  }

  private async getHelpResponse(timestamp: string): Promise<AIResponse> {
    const customObjects = await this.metadataService.getCustomObjects();
    const caps = toolRegistry.getCapabilities();
    
    // Build dynamic feature list based on what's actually available
    const features: string[] = [];
    
    if (caps.hasProjects) {
      features.push(`• "Show project distribution by status"`);
      features.push(`• "List projects" / "How many projects?"`);
    }
    if (caps.hasTasks) {
      features.push(`• "List tasks" / "Analyze tasks by priority"`);
    }
    if (caps.hasCustomObjects && customObjects.length > 0) {
      features.push(`• "List custom objects"`);
      features.push(`• "Show ${customObjects[0]?.label || 'custom object'} data"`);
    }
    features.push(`• "Give me a link to project X"`);
    features.push(`• "Show me the active ones" (after a chart)`);
    
    // Build available objects list
    const objectsList: string[] = [];
    if (caps.hasProjects) objectsList.push('projects');
    if (caps.hasTasks) objectsList.push('tasks');
    if (caps.hasResources) objectsList.push('resources');
    
    const customList = customObjects.length > 0
      ? customObjects.slice(0, 5).map(o => o.label).join(', ')
      : 'none detected';

    return {
      success: true,
      reply: `🤖 **Clarity AI Assistant**\n\n` +
        `I understand natural language and remember our conversation!\n\n` +
        `**Try:**\n` +
        features.slice(0, 6).join('\n') + `\n\n` +
        `**Available:** ${objectsList.join(', ')}${caps.hasCustomObjects ? ` + ${customObjects.length} custom objects` : ''}\n` +
        (customObjects.length > 0 ? `**Custom Objects:** ${customList}...\n\n` : '\n') +
        `💡 After viewing a chart, click bars to drill down!`,
      chartData: null,
      timestamp,
    };
  }
}
