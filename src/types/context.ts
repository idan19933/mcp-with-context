/**
 * Conversation Context Types
 * Enables memory across messages in a session
 */

export interface ConversationContext {
  sessionId: string;
  
  // Last query information for drill-down and follow-up
  lastQuery?: {
    objectType: string;
    objectLabel: string;
    action: string;
    filters?: Record<string, string>;
    results?: Array<Record<string, unknown>>;
    totalCount?: number;
    groupByField?: string;
    groupByDisplayName?: string;
    chartData?: Record<string, Array<{ label: string; value: number }>>;
    timestamp: string;
  };
  
  // Current page context (if provided by frontend)
  currentPage?: {
    objectType: string;
    recordId?: string;
    recordName?: string;
    url?: string;
  };
  
  // Conversation history (last N messages)
  history: ConversationTurn[];
  
  // User preferences learned from conversation
  preferences?: {
    preferredChartType?: 'bar' | 'pie' | 'line' | 'doughnut';
    language?: 'he' | 'en';
    detailLevel?: 'brief' | 'detailed';
  };
}

export interface ConversationTurn {
  timestamp: string;
  role: 'user' | 'assistant';
  message: string;
  action?: string;
  objectType?: string;
  success?: boolean;
}

export interface DrillDownRequest {
  fromField: string;           // Field that was grouped by
  selectedValue: string;       // The value clicked (e.g., "Active")
  objectType: string;          // Object type (e.g., "projects")
  additionalFilters?: Record<string, string>;
}

export interface DrillDownResponse {
  success: boolean;
  objectType: string;
  objectLabel: string;
  filter: string;
  filterDisplayName: string;
  records: Array<Record<string, unknown>>;
  totalCount: number;
  deepLink?: string;
  suggestions: string[];
}

// Context-aware follow-up patterns
export const FOLLOW_UP_PATTERNS = {
  // Drill-down from chart
  showSelected: [
    /show\s*(me\s*)?(the\s*)?(\w+)\s*ones?/i,           // "show me the active ones"
    /list\s*(the\s*)?(\w+)\s*ones?/i,                   // "list the completed ones"
    /get\s*(me\s*)?(the\s*)?(\w+)/i,                    // "get me the active"
    /which\s*(ones?\s*)?(are\s*)?(\w+)/i,              // "which are active"
    /הראה\s*(לי\s*)?(את\s*)?(ה)?(\w+)/i,               // Hebrew: "הראה לי את האקטיביים"
  ],
  
  // Export requests
  export: [
    /export\s*(them|this|these|it)?(\s*to\s*excel)?/i,  // "export them to excel"
    /download/i,                                         // "download"
    /ייצא/i,                                             // Hebrew: "ייצא"
  ],
  
  // Count follow-up
  count: [
    /how\s*many\s*(total|are\s*there)?/i,              // "how many total"
    /count\s*(them|all)?/i,                             // "count them"
    /כמה/i,                                             // Hebrew: "כמה"
  ],
  
  // More details
  details: [
    /tell\s*me\s*more/i,                               // "tell me more"
    /more\s*details?/i,                                // "more details"
    /expand/i,                                          // "expand"
    /פרטים/i,                                          // Hebrew: "פרטים"
  ],
  
  // Filter modification
  filter: [
    /filter\s*(by|where)/i,                            // "filter by status"
    /only\s*(show\s*)?(the\s*)?/i,                    // "only show active"
    /where\s+(\w+)\s*(is|=|equals)/i,                 // "where status is active"
  ],
  
  // Deep link request
  link: [
    /link\s*(to\s*)?(this|them|it)?/i,                // "link to this"
    /open\s*(in\s*)?clarity/i,                         // "open in clarity"
    /url/i,                                            // "url"
    /לינק/i,                                           // Hebrew: "לינק"
  ],
} as const;

// Helper to detect follow-up intent
export function detectFollowUpIntent(message: string): { 
  type: keyof typeof FOLLOW_UP_PATTERNS | null; 
  extractedValue?: string;
} {
  const lowerMessage = message.toLowerCase();
  
  for (const [intentType, patterns] of Object.entries(FOLLOW_UP_PATTERNS)) {
    for (const pattern of patterns) {
      const match = lowerMessage.match(pattern);
      if (match) {
        // Try to extract the value (e.g., "active" from "show me the active ones")
        const extractedValue = match[3] || match[2] || match[1];
        return { 
          type: intentType as keyof typeof FOLLOW_UP_PATTERNS, 
          extractedValue: extractedValue?.trim() 
        };
      }
    }
  }
  
  return { type: null };
}
