/**
 * Tool Registry v3.1
 * Manages available tools dynamically based on:
 * 1. Session permissions
 * 2. Actual Clarity API capabilities (validated at runtime)
 * 3. Objects that actually exist in the system
 */

export interface ToolDefinition {
  id: string;
  name: string;
  description: string;
  icon: string;
  category: 'query' | 'analyze' | 'create' | 'update' | 'delete' | 'admin' | 'export';
  requiredPermissions: Permission[];
  parameters?: ToolParameter[];
  examples?: string[];
  // NEW: validation function - returns true if tool is actually usable
  isAvailable?: () => boolean;
}

export interface ToolParameter {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'select';
  required: boolean;
  description: string;
  options?: string[]; // For select type
  default?: string | number | boolean;
}

export type Permission = 
  | 'read'           // Can query/view data
  | 'write'          // Can create/update data
  | 'delete'         // Can delete data
  | 'analyze'        // Can run analytics/charts
  | 'export'         // Can export data
  | 'admin'          // Full access
  | 'custom_objects' // Can access custom objects
  | 'projects'       // Can access projects
  | 'tasks'          // Can access tasks
  | 'resources'      // Can access resources
  | 'financials';    // Can access financial data

export interface SessionPermissions {
  sessionId: string;
  userId?: string;
  permissions: Permission[];
  allowedObjects?: string[];  // Specific objects user can access
  deniedObjects?: string[];   // Objects user cannot access
  createdAt: Date;
  expiresAt?: Date;
}

// ============================================================================
// CAPABILITY FLAGS - Set dynamically based on Clarity API validation
// ============================================================================

export interface ClarityCapabilities {
  canRead: boolean;
  canWrite: boolean;
  canDelete: boolean;
  hasProjects: boolean;
  hasTasks: boolean;
  hasResources: boolean;
  hasCustomObjects: boolean;
  customObjectCodes: string[];  // Actually existing custom objects
  apiVersion: string;
  validatedAt: Date;
}

// Default: nothing validated yet
let clarityCapabilities: ClarityCapabilities = {
  canRead: false,
  canWrite: false,
  canDelete: false,
  hasProjects: false,
  hasTasks: false,
  hasResources: false,
  hasCustomObjects: false,
  customObjectCodes: [],
  apiVersion: 'unknown',
  validatedAt: new Date(0),
};

// ============================================================================
// TOOL DEFINITIONS - with isAvailable checks
// ============================================================================

export const ALL_TOOLS: ToolDefinition[] = [
  // Query Tools
  {
    id: 'list_records',
    name: 'List Records',
    description: 'List records from any object with optional filters',
    icon: '📋',
    category: 'query',
    requiredPermissions: ['read'],
    parameters: [
      { name: 'object', type: 'string', required: true, description: 'Object type to query' },
      { name: 'limit', type: 'number', required: false, description: 'Max records to return', default: 20 },
      { name: 'filter', type: 'string', required: false, description: 'Filter expression' },
    ],
    examples: ['list projects', 'show all tasks', 'list custom object Y'],
    isAvailable: () => clarityCapabilities.canRead,
  },
  {
    id: 'count_records',
    name: 'Count Records',
    description: 'Count records in an object',
    icon: '🔢',
    category: 'query',
    requiredPermissions: ['read'],
    parameters: [
      { name: 'object', type: 'string', required: true, description: 'Object type to count' },
    ],
    examples: ['how many projects', 'count tasks'],
    isAvailable: () => clarityCapabilities.canRead,
  },
  {
    id: 'get_record',
    name: 'Get Record Details',
    description: 'Get details of a specific record',
    icon: '🔍',
    category: 'query',
    requiredPermissions: ['read'],
    parameters: [
      { name: 'object', type: 'string', required: true, description: 'Object type' },
      { name: 'id', type: 'string', required: true, description: 'Record ID or code' },
    ],
    examples: ['show project X details', 'get task ABC info'],
    isAvailable: () => clarityCapabilities.canRead,
  },
  
  // Analyze Tools
  {
    id: 'create_chart',
    name: 'Create Chart',
    description: 'Create distribution chart grouped by a field',
    icon: '📊',
    category: 'analyze',
    requiredPermissions: ['read', 'analyze'],
    parameters: [
      { name: 'object', type: 'string', required: true, description: 'Object type to analyze' },
      { name: 'groupBy', type: 'string', required: true, description: 'Field to group by' },
    ],
    examples: ['show project distribution by status', 'chart tasks by priority'],
    isAvailable: () => clarityCapabilities.canRead,
  },
  {
    id: 'drill_down',
    name: 'Drill Down',
    description: 'Show records matching a specific value from a chart',
    icon: '🔎',
    category: 'analyze',
    requiredPermissions: ['read', 'analyze'],
    parameters: [
      { name: 'value', type: 'string', required: true, description: 'Value to filter by' },
    ],
    examples: ['show me the active ones', 'drill down to completed'],
    isAvailable: () => clarityCapabilities.canRead,
  },
  
  // Link Tools
  {
    id: 'get_deep_link',
    name: 'Get Deep Link',
    description: 'Get a direct link to Clarity',
    icon: '🔗',
    category: 'query',
    requiredPermissions: ['read'],
    examples: ['give me a link', 'open in clarity', 'link to project X'],
    isAvailable: () => clarityCapabilities.canRead,
  },
  
  // Create Tools
  {
    id: 'create_record',
    name: 'Create Record',
    description: 'Create a new record in an object',
    icon: '➕',
    category: 'create',
    requiredPermissions: ['write'],
    parameters: [
      { name: 'object', type: 'string', required: true, description: 'Object type' },
      { name: 'name', type: 'string', required: true, description: 'Record name' },
    ],
    examples: ['create project called X', 'add task Y'],
    isAvailable: () => clarityCapabilities.canWrite,
  },
  
  // Update Tools
  {
    id: 'update_record',
    name: 'Update Record',
    description: 'Update an existing record',
    icon: '✏️',
    category: 'update',
    requiredPermissions: ['write'],
    parameters: [
      { name: 'object', type: 'string', required: true, description: 'Object type' },
      { name: 'id', type: 'string', required: true, description: 'Record ID or code' },
    ],
    examples: ['update project X status', 'change task Y priority'],
    isAvailable: () => clarityCapabilities.canWrite,
  },
  
  // Delete Tools
  {
    id: 'delete_record',
    name: 'Delete Record',
    description: 'Delete a record',
    icon: '🗑️',
    category: 'delete',
    requiredPermissions: ['delete'],
    parameters: [
      { name: 'object', type: 'string', required: true, description: 'Object type' },
      { name: 'id', type: 'string', required: true, description: 'Record ID or code' },
    ],
    examples: ['delete project X', 'remove task Y'],
    isAvailable: () => clarityCapabilities.canDelete,
  },
  
  // Export Tools
  {
    id: 'export_data',
    name: 'Export Data',
    description: 'Export data to various formats',
    icon: '📥',
    category: 'export',
    requiredPermissions: ['read', 'export'],
    examples: ['export to excel', 'download as CSV'],
    isAvailable: () => clarityCapabilities.canRead,
  },
  
  // Admin Tools
  {
    id: 'list_objects',
    name: 'List Objects',
    description: 'List all available objects and custom objects',
    icon: '📦',
    category: 'admin',
    requiredPermissions: ['read'],
    examples: ['list custom objects', 'show available objects'],
    isAvailable: () => clarityCapabilities.canRead,
  },
  {
    id: 'describe_object',
    name: 'Describe Object',
    description: 'Show object metadata and fields',
    icon: '📋',
    category: 'admin',
    requiredPermissions: ['read'],
    parameters: [
      { name: 'object', type: 'string', required: true, description: 'Object type to describe' },
    ],
    examples: ['describe projects', 'what fields does X have'],
    isAvailable: () => clarityCapabilities.canRead,
  },
];

// ============================================================================
// PERMISSION PRESETS
// ============================================================================

export const PERMISSION_PRESETS: Record<string, Permission[]> = {
  readonly: ['read'],
  analyst: ['read', 'analyze', 'export'],
  editor: ['read', 'analyze', 'write'],
  manager: ['read', 'analyze', 'write', 'export', 'custom_objects', 'projects', 'tasks'],
  admin: ['read', 'analyze', 'write', 'delete', 'export', 'admin', 'custom_objects', 'projects', 'tasks', 'resources', 'financials'],
};

// ============================================================================
// TOOL REGISTRY CLASS
// ============================================================================

export class ToolRegistry {
  private sessionPermissions: Map<string, SessionPermissions> = new Map();
  
  /**
   * Validate capabilities against the actual Clarity API
   * Called once at server startup and periodically
   */
  async validateCapabilities(clarityClient: {
    get: <T>(endpoint: string) => Promise<T>;
  }): Promise<ClarityCapabilities> {
    console.log('[ToolRegistry] Validating Clarity capabilities...');
    
    const capabilities: ClarityCapabilities = {
      canRead: false,
      canWrite: false,
      canDelete: false,
      hasProjects: false,
      hasTasks: false,
      hasResources: false,
      hasCustomObjects: false,
      customObjectCodes: [],
      apiVersion: 'unknown',
      validatedAt: new Date(),
    };
    
    // Test 1: Can we read projects?
    try {
      const response = await clarityClient.get<Record<string, unknown>>(
        '/projects?fields=_internalId&limit=1'
      );
      capabilities.canRead = true;
      capabilities.hasProjects = true;
      console.log('[ToolRegistry] ✅ Read access confirmed (projects)');
    } catch (error) {
      console.log('[ToolRegistry] ❌ Cannot read projects:', error);
    }
    
    // Test 2: Can we read tasks?
    try {
      await clarityClient.get<Record<string, unknown>>(
        '/tasks?fields=_internalId&limit=1'
      );
      capabilities.hasTasks = true;
      console.log('[ToolRegistry] ✅ Tasks access confirmed');
    } catch {
      console.log('[ToolRegistry] ❌ Cannot access tasks');
    }
    
    // Test 3: Can we read resources?
    try {
      await clarityClient.get<Record<string, unknown>>(
        '/resources?fields=_internalId&limit=1'
      );
      capabilities.hasResources = true;
      console.log('[ToolRegistry] ✅ Resources access confirmed');
    } catch {
      console.log('[ToolRegistry] ❌ Cannot access resources');
    }
    
    // Test 4: Custom objects
    try {
      const response = await clarityClient.get<Record<string, unknown>>(
        '/customObjectMetadata'
      );
      const objects = (response._results ?? []) as Array<Record<string, unknown>>;
      capabilities.hasCustomObjects = objects.length > 0;
      capabilities.customObjectCodes = objects
        .map(o => o.resourceName as string)
        .filter(Boolean);
      console.log(`[ToolRegistry] ✅ Custom objects: ${capabilities.customObjectCodes.length} found`);
    } catch {
      console.log('[ToolRegistry] ❌ Cannot access custom objects');
    }
    
    // Test 5: Write access (try OPTIONS or just mark based on auth)
    // We don't actually try to write - we assume write if read works
    // The actual permission is controlled by session role
    capabilities.canWrite = capabilities.canRead; // Server has write access
    capabilities.canDelete = capabilities.canRead; // Server has delete access
    
    clarityCapabilities = capabilities;
    
    console.log('[ToolRegistry] Capabilities validated:', {
      canRead: capabilities.canRead,
      hasProjects: capabilities.hasProjects,
      hasTasks: capabilities.hasTasks,
      hasResources: capabilities.hasResources,
      customObjects: capabilities.customObjectCodes.length,
    });
    
    return capabilities;
  }
  
  /**
   * Get current capabilities
   */
  getCapabilities(): ClarityCapabilities {
    return { ...clarityCapabilities };
  }
  
  /**
   * Check if capabilities need refresh (older than 10 minutes)
   */
  needsRefresh(): boolean {
    const ageMs = Date.now() - clarityCapabilities.validatedAt.getTime();
    return ageMs > 10 * 60 * 1000;
  }
  
  /**
   * Register a new session with permissions
   */
  registerSession(
    sessionId: string, 
    permissions: Permission[] | keyof typeof PERMISSION_PRESETS,
    options?: {
      userId?: string;
      allowedObjects?: string[];
      deniedObjects?: string[];
      expiresInMinutes?: number;
    }
  ): SessionPermissions {
    const perms = typeof permissions === 'string' 
      ? PERMISSION_PRESETS[permissions] ?? ['read']
      : permissions;
    
    const session: SessionPermissions = {
      sessionId,
      userId: options?.userId,
      permissions: perms,
      allowedObjects: options?.allowedObjects,
      deniedObjects: options?.deniedObjects,
      createdAt: new Date(),
      expiresAt: options?.expiresInMinutes 
        ? new Date(Date.now() + options.expiresInMinutes * 60 * 1000)
        : undefined,
    };
    
    this.sessionPermissions.set(sessionId, session);
    console.log(`[ToolRegistry] Session ${sessionId} registered with: ${perms.join(', ')}`);
    
    return session;
  }
  
  /**
   * Get session permissions
   */
  getSessionPermissions(sessionId: string): SessionPermissions | null {
    const session = this.sessionPermissions.get(sessionId);
    
    if (!session) return null;
    
    // Check if expired
    if (session.expiresAt && new Date() > session.expiresAt) {
      this.sessionPermissions.delete(sessionId);
      return null;
    }
    
    return session;
  }
  
  /**
   * Get tools available for a session
   * Filters by BOTH: permission AND actual API capability
   */
  getAvailableTools(sessionId: string): ToolDefinition[] {
    const session = this.getSessionPermissions(sessionId);
    const perms = session?.permissions ?? ['read'];
    
    return ALL_TOOLS.filter(tool => {
      // Check 1: User has required permissions
      const hasPermissions = tool.requiredPermissions.every(p => perms.includes(p));
      if (!hasPermissions) return false;
      
      // Check 2: Tool is actually available (Clarity API supports it)
      if (tool.isAvailable && !tool.isAvailable()) return false;
      
      return true;
    });
  }
  
  /**
   * Check if session can use a specific tool
   */
  canUseTool(sessionId: string, toolId: string): boolean {
    const availableTools = this.getAvailableTools(sessionId);
    return availableTools.some(t => t.id === toolId);
  }
  
  /**
   * Check if session can access an object
   */
  canAccessObject(sessionId: string, objectType: string): boolean {
    const session = this.getSessionPermissions(sessionId);
    
    if (!session) return true;
    
    if (session.deniedObjects?.includes(objectType)) return false;
    
    if (session.allowedObjects && session.allowedObjects.length > 0) {
      return session.allowedObjects.includes(objectType);
    }
    
    return true;
  }
  
  /**
   * Update session permissions
   */
  updateSessionPermissions(sessionId: string, permissions: Permission[]): boolean {
    const session = this.sessionPermissions.get(sessionId);
    if (!session) return false;
    
    session.permissions = permissions;
    this.sessionPermissions.set(sessionId, session);
    return true;
  }
  
  /**
   * Remove session
   */
  removeSession(sessionId: string): boolean {
    return this.sessionPermissions.delete(sessionId);
  }
  
  /**
   * Get tools grouped by category
   */
  getToolsByCategory(sessionId: string): Record<string, ToolDefinition[]> {
    const tools = this.getAvailableTools(sessionId);
    const grouped: Record<string, ToolDefinition[]> = {};
    
    for (const tool of tools) {
      if (!grouped[tool.category]) grouped[tool.category] = [];
      grouped[tool.category].push(tool);
    }
    
    return grouped;
  }
  
  /**
   * Format tools for API response
   * Includes capability info so the client knows what's real
   */
  formatToolsForClient(sessionId: string): {
    tools: Array<{
      id: string;
      name: string;
      description: string;
      icon: string;
      category: string;
      examples: string[];
    }>;
    permissions: Permission[];
    categories: string[];
    capabilities: {
      hasProjects: boolean;
      hasTasks: boolean;
      hasResources: boolean;
      hasCustomObjects: boolean;
      customObjectCount: number;
      validatedAt: string;
    };
  } {
    const session = this.getSessionPermissions(sessionId);
    const tools = this.getAvailableTools(sessionId);
    
    return {
      tools: tools.map(t => ({
        id: t.id,
        name: t.name,
        description: t.description,
        icon: t.icon,
        category: t.category,
        examples: t.examples ?? [],
      })),
      permissions: session?.permissions ?? ['read'],
      categories: [...new Set(tools.map(t => t.category))],
      capabilities: {
        hasProjects: clarityCapabilities.hasProjects,
        hasTasks: clarityCapabilities.hasTasks,
        hasResources: clarityCapabilities.hasResources,
        hasCustomObjects: clarityCapabilities.hasCustomObjects,
        customObjectCount: clarityCapabilities.customObjectCodes.length,
        validatedAt: clarityCapabilities.validatedAt.toISOString(),
      },
    };
  }
}

// Export singleton instance
export const toolRegistry = new ToolRegistry();
