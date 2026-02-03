/**
 * Suggestion Service
 * Generates smart follow-up suggestions based on context
 */

import type { ConversationContext } from '../types/context.js';

export interface Suggestion {
  text: string;
  emoji: string;
  action: string;
  priority: number;
}

export class SuggestionService {
  /**
   * Generate suggestions based on the last action and context
   */
  generateSuggestions(
    context: ConversationContext,
    action: string,
    maxSuggestions: number = 4
  ): Suggestion[] {
    const suggestions: Suggestion[] = [];

    switch (action) {
      case 'analyze':
        suggestions.push(...this.getAnalyzeSuggestions(context));
        break;
      
      case 'query':
        suggestions.push(...this.getQuerySuggestions(context));
        break;
      
      case 'create':
        suggestions.push(...this.getCreateSuggestions(context));
        break;
      
      case 'update':
      case 'delete':
        suggestions.push(...this.getModifySuggestions(context));
        break;
      
      default:
        suggestions.push(...this.getDefaultSuggestions(context));
    }

    // Sort by priority and limit
    return suggestions
      .sort((a, b) => b.priority - a.priority)
      .slice(0, maxSuggestions);
  }

  /**
   * Suggestions after chart/analysis
   */
  private getAnalyzeSuggestions(context: ConversationContext): Suggestion[] {
    const suggestions: Suggestion[] = [];
    const lastQuery = context.lastQuery;

    if (lastQuery?.chartData && lastQuery.groupByField) {
      // Get top values from chart
      const chartValues = lastQuery.chartData[lastQuery.groupByField];
      
      if (chartValues && chartValues.length > 0) {
        const topValue = chartValues[0]?.label;
        const secondValue = chartValues[1]?.label;

        if (topValue) {
          suggestions.push({
            text: `Show me the "${topValue}" ones`,
            emoji: '🔍',
            action: 'drilldown',
            priority: 100,
          });
        }

        if (secondValue) {
          suggestions.push({
            text: `Show me the "${secondValue}" ones`,
            emoji: '🔍',
            action: 'drilldown',
            priority: 90,
          });
        }
      }

      // Suggest different grouping
      suggestions.push({
        text: `Group by a different field`,
        emoji: '📊',
        action: 'analyze',
        priority: 70,
      });
    }

    // Export suggestion
    suggestions.push({
      text: `Export to Excel`,
      emoji: '📥',
      action: 'export',
      priority: 60,
    });

    // Link suggestion
    suggestions.push({
      text: `Get a link to this view`,
      emoji: '🔗',
      action: 'link',
      priority: 50,
    });

    return suggestions;
  }

  /**
   * Suggestions after list query
   */
  private getQuerySuggestions(context: ConversationContext): Suggestion[] {
    const suggestions: Suggestion[] = [];
    const lastQuery = context.lastQuery;

    if (lastQuery?.objectType) {
      // Analyze suggestion
      suggestions.push({
        text: `Show distribution by status`,
        emoji: '📊',
        action: 'analyze',
        priority: 100,
      });

      // Count suggestion
      suggestions.push({
        text: `How many total?`,
        emoji: '🔢',
        action: 'count',
        priority: 80,
      });

      // Filter suggestion
      suggestions.push({
        text: `Filter by specific criteria`,
        emoji: '🔍',
        action: 'filter',
        priority: 70,
      });

      // Create suggestion
      suggestions.push({
        text: `Create a new ${lastQuery.objectLabel?.slice(0, -1) || 'record'}`,
        emoji: '➕',
        action: 'create',
        priority: 50,
      });
    }

    return suggestions;
  }

  /**
   * Suggestions after create
   */
  private getCreateSuggestions(context: ConversationContext): Suggestion[] {
    const lastQuery = context.lastQuery;

    return [
      {
        text: `Create another one`,
        emoji: '➕',
        action: 'create',
        priority: 100,
      },
      {
        text: `List all ${lastQuery?.objectLabel || 'records'}`,
        emoji: '📋',
        action: 'query',
        priority: 80,
      },
      {
        text: `Show distribution`,
        emoji: '📊',
        action: 'analyze',
        priority: 60,
      },
    ];
  }

  /**
   * Suggestions after update/delete
   */
  private getModifySuggestions(context: ConversationContext): Suggestion[] {
    const lastQuery = context.lastQuery;

    return [
      {
        text: `List all ${lastQuery?.objectLabel || 'records'}`,
        emoji: '📋',
        action: 'query',
        priority: 100,
      },
      {
        text: `Show distribution`,
        emoji: '📊',
        action: 'analyze',
        priority: 80,
      },
      {
        text: `Create a new one`,
        emoji: '➕',
        action: 'create',
        priority: 60,
      },
    ];
  }

  /**
   * Default suggestions
   */
  private getDefaultSuggestions(context: ConversationContext): Suggestion[] {
    return [
      {
        text: `Show project distribution by status`,
        emoji: '📊',
        action: 'analyze',
        priority: 100,
      },
      {
        text: `List all projects`,
        emoji: '📋',
        action: 'query',
        priority: 80,
      },
      {
        text: `How many tasks in the system?`,
        emoji: '🔢',
        action: 'count',
        priority: 60,
      },
      {
        text: `List custom objects`,
        emoji: '📦',
        action: 'describe',
        priority: 40,
      },
    ];
  }

  /**
   * Format suggestions for display in chat
   */
  formatSuggestionsForChat(suggestions: Suggestion[]): string {
    if (suggestions.length === 0) return '';

    let text = '\n\n💡 **Try asking:**\n';
    
    for (const suggestion of suggestions) {
      text += `${suggestion.emoji} "${suggestion.text}"\n`;
    }

    return text;
  }

  /**
   * Format suggestions as clickable buttons (for frontend)
   */
  formatSuggestionsAsButtons(suggestions: Suggestion[]): Array<{
    label: string;
    value: string;
  }> {
    return suggestions.map(s => ({
      label: `${s.emoji} ${s.text}`,
      value: s.text,
    }));
  }
}
