/**
 * Session Manager
 * Handles session creation, authentication, and authorization
 */

import { toolRegistry, type Permission, PERMISSION_PRESETS } from './ToolRegistry.js';

export interface SessionConfig {
  sessionId: string;
  userId?: string;
  username?: string;
  role?: keyof typeof PERMISSION_PRESETS;
  permissions?: Permission[];
  allowedObjects?: string[];
  deniedObjects?: string[];
  metadata?: Record<string, unknown>;
  expiresInMinutes?: number;
}

export interface SessionInfo {
  sessionId: string;
  userId?: string;
  username?: string;
  permissions: Permission[];
  allowedTools: string[];
  createdAt: string;
  expiresAt?: string;
}

// ============================================================================
// SESSION MANAGER
// ============================================================================

export class SessionManager {
  private sessionMetadata: Map<string, Record<string, unknown>> = new Map();
  
  /**
   * Create a new session with configuration
   */
  createSession(config: SessionConfig): SessionInfo {
    const permissions = config.permissions ?? 
      (config.role ? PERMISSION_PRESETS[config.role] : ['read']);
    
    // Register with tool registry
    const session = toolRegistry.registerSession(
      config.sessionId,
      permissions,
      {
        userId: config.userId,
        allowedObjects: config.allowedObjects,
        deniedObjects: config.deniedObjects,
        expiresInMinutes: config.expiresInMinutes ?? 60, // Default 1 hour
      }
    );
    
    // Store additional metadata
    if (config.metadata) {
      this.sessionMetadata.set(config.sessionId, {
        ...config.metadata,
        username: config.username,
      });
    }
    
    // Get available tools for this session
    const tools = toolRegistry.getAvailableTools(config.sessionId);
    
    console.log(`[SessionManager] Created session ${config.sessionId} for user ${config.username ?? 'anonymous'}`);
    
    return {
      sessionId: config.sessionId,
      userId: config.userId,
      username: config.username,
      permissions: session.permissions,
      allowedTools: tools.map(t => t.id),
      createdAt: session.createdAt.toISOString(),
      expiresAt: session.expiresAt?.toISOString(),
    };
  }
  
  /**
   * Create session from Clarity user info
   */
  createSessionFromClarityUser(
    sessionId: string,
    clarityUser: {
      username: string;
      userId: string;
      groups?: string[];
      isAdmin?: boolean;
    }
  ): SessionInfo {
    // Determine role based on Clarity groups
    let role: keyof typeof PERMISSION_PRESETS = 'readonly';
    
    if (clarityUser.isAdmin) {
      role = 'admin';
    } else if (clarityUser.groups?.some(g => g.toLowerCase().includes('manager'))) {
      role = 'manager';
    } else if (clarityUser.groups?.some(g => g.toLowerCase().includes('editor'))) {
      role = 'editor';
    } else if (clarityUser.groups?.some(g => g.toLowerCase().includes('analyst'))) {
      role = 'analyst';
    }
    
    return this.createSession({
      sessionId,
      userId: clarityUser.userId,
      username: clarityUser.username,
      role,
      metadata: {
        clarityGroups: clarityUser.groups,
      },
    });
  }
  
  /**
   * Get session info
   */
  getSession(sessionId: string): SessionInfo | null {
    const permissions = toolRegistry.getSessionPermissions(sessionId);
    if (!permissions) return null;
    
    const tools = toolRegistry.getAvailableTools(sessionId);
    const metadata = this.sessionMetadata.get(sessionId);
    
    return {
      sessionId,
      userId: permissions.userId,
      username: metadata?.['username'] as string | undefined,
      permissions: permissions.permissions,
      allowedTools: tools.map(t => t.id),
      createdAt: permissions.createdAt.toISOString(),
      expiresAt: permissions.expiresAt?.toISOString(),
    };
  }
  
  /**
   * Validate session and check tool permission
   */
  validateToolAccess(sessionId: string, toolId: string): { 
    allowed: boolean; 
    reason?: string;
  } {
    const session = toolRegistry.getSessionPermissions(sessionId);
    
    if (!session) {
      return { allowed: false, reason: 'Session not found or expired' };
    }
    
    if (!toolRegistry.canUseTool(sessionId, toolId)) {
      return { allowed: false, reason: `Insufficient permissions for tool: ${toolId}` };
    }
    
    return { allowed: true };
  }
  
  /**
   * Validate object access
   */
  validateObjectAccess(sessionId: string, objectType: string): {
    allowed: boolean;
    reason?: string;
  } {
    if (!toolRegistry.canAccessObject(sessionId, objectType)) {
      return { allowed: false, reason: `Access denied to object: ${objectType}` };
    }
    
    return { allowed: true };
  }
  
  /**
   * End session
   */
  endSession(sessionId: string): boolean {
    this.sessionMetadata.delete(sessionId);
    return toolRegistry.removeSession(sessionId);
  }
  
  /**
   * Refresh session (extend expiry)
   */
  refreshSession(sessionId: string, extendMinutes: number = 60): SessionInfo | null {
    const current = this.getSession(sessionId);
    if (!current) return null;
    
    // Re-create with extended expiry
    return this.createSession({
      sessionId,
      userId: current.userId,
      username: current.username,
      permissions: current.permissions,
      expiresInMinutes: extendMinutes,
    });
  }
}

// Export singleton instance
export const sessionManager = new SessionManager();
