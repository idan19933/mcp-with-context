/**
 * Clarity PPM MCP Server v3.0
 * 
 * Features:
 * - AI Chat with Claude
 * - Conversation Context (memory)
 * - Drill-down from charts
 * - Smart suggestions
 * - Deep links to Clarity
 * - Dynamic Tools with Permissions
 * - Session Management
 */

import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';

import { ClarityApiClient, createClarityClient } from './services/ClarityApiClient.js';
import { MetadataService } from './services/MetadataService.js';
import { LookupService } from './services/LookupService.js';
import { AIChatHandler } from './aiChatHandler.js';
import { toolRegistry } from './tools/ToolRegistry.js';
import { sessionManager } from './tools/SessionManager.js';

// Load environment variables
dotenv.config();

// ============================================================================
// CONFIGURATION
// ============================================================================

const config = {
  port: parseInt(process.env['PORT'] ?? '3000', 10),
  clarityBaseUrl: process.env['CLARITY_BASE_URL'] ?? '',
  clarityUsername: process.env['CLARITY_USERNAME'],
  clarityPassword: process.env['CLARITY_PASSWORD'],
  claritySessionId: process.env['CLARITY_SESSION_ID'],
  clarityAuthToken: process.env['CLARITY_AUTH_TOKEN'],
};

// ============================================================================
// SERVICES
// ============================================================================

let sharedServices: {
  clarityClient: ClarityApiClient;
  metadataService: MetadataService;
  lookupService: LookupService;
  chatHandler: AIChatHandler;
} | null = null;

function getServices() {
  if (!sharedServices) {
    const clarityClient = createClarityClient({
      baseUrl: config.clarityBaseUrl,
      username: config.clarityUsername,
      password: config.clarityPassword,
      sessionId: config.claritySessionId,
      authToken: config.clarityAuthToken,
    });
    
    const metadataService = new MetadataService(clarityClient);
    const lookupService = new LookupService(clarityClient);
    
    sharedServices = {
      clarityClient,
      metadataService,
      lookupService,
      chatHandler: new AIChatHandler(
        clarityClient, 
        metadataService, 
        lookupService, 
        config.clarityBaseUrl
      ),
    };
  }
  return sharedServices;
}

// ============================================================================
// EXPRESS SERVER
// ============================================================================

const app = express();

app.use(cors());
app.use(express.json());

// Health check
app.get('/health', (_req, res) => {
  const caps = toolRegistry.getCapabilities();
  res.json({ 
    status: 'ok', 
    version: '3.1.0',
    features: ['ai-chat', 'context-memory', 'drill-down', 'suggestions', 'deep-links', 'dynamic-tools', 'sessions'],
    capabilities: {
      canRead: caps.canRead,
      hasProjects: caps.hasProjects,
      hasTasks: caps.hasTasks,
      hasResources: caps.hasResources,
      hasCustomObjects: caps.hasCustomObjects,
      customObjectCount: caps.customObjectCodes.length,
      validatedAt: caps.validatedAt.toISOString(),
    },
    timestamp: new Date().toISOString() 
  });
});

// AI Chat endpoint
app.post('/api/chat', async (req, res) => {
  try {
    const { message, sessionId } = req.body as { message?: string; sessionId?: string };
    
    if (!message || typeof message !== 'string') {
      res.status(400).json({ error: 'Message is required' });
      return;
    }
    
    const services = getServices();
    const response = await services.chatHandler.handleMessage(
      message, 
      sessionId ?? 'default'
    );
    
    res.json(response);
  } catch (error) {
    console.error('[API] Chat error:', error);
    res.status(500).json({ 
      error: error instanceof Error ? error.message : 'Internal server error',
      timestamp: new Date().toISOString(),
    });
  }
});

// List custom objects
app.get('/api/objects/custom', async (_req, res) => {
  try {
    const services = getServices();
    const customObjects = await services.metadataService.getCustomObjects();
    res.json({ success: true, objects: customObjects });
  } catch (error) {
    console.error('[API] Custom objects error:', error);
    res.status(500).json({ error: error instanceof Error ? error.message : 'Error' });
  }
});

// Get object metadata
app.get('/api/objects/:objectType/metadata', async (req, res) => {
  try {
    const { objectType } = req.params;
    const services = getServices();
    const metadata = await services.metadataService.getObjectMetadata(objectType!);
    res.json({ success: true, metadata });
  } catch (error) {
    console.error('[API] Metadata error:', error);
    res.status(500).json({ error: error instanceof Error ? error.message : 'Error' });
  }
});

// Proxy to Clarity API
app.get('/api/clarity/*', async (req, res) => {
  try {
    const wildcardParam = (req.params as Record<string, string>)['0'] ?? '';
    const endpoint = '/' + wildcardParam;
    const queryString = new URLSearchParams(req.query as Record<string, string>).toString();
    const fullEndpoint = queryString ? `${endpoint}?${queryString}` : endpoint;
    
    const services = getServices();
    const data = await services.clarityClient.get(fullEndpoint);
    res.json(data);
  } catch (error) {
    console.error('[API] Clarity proxy error:', error);
    res.status(500).json({ error: error instanceof Error ? error.message : 'Error' });
  }
});

app.post('/api/clarity/*', async (req, res) => {
  try {
    const wildcardParam = (req.params as Record<string, string>)['0'] ?? '';
    const endpoint = '/' + wildcardParam;
    const services = getServices();
    const data = await services.clarityClient.post(endpoint, req.body);
    res.json(data);
  } catch (error) {
    console.error('[API] Clarity proxy error:', error);
    res.status(500).json({ error: error instanceof Error ? error.message : 'Error' });
  }
});

// ============================================================================
// SESSION MANAGEMENT ENDPOINTS
// ============================================================================

// Create a new session
app.post('/api/session', async (req, res) => {
  try {
    const { 
      sessionId, 
      userId, 
      username, 
      role, 
      permissions,
      allowedObjects,
      deniedObjects,
      expiresInMinutes,
      metadata,
    } = req.body as {
      sessionId?: string;
      userId?: string;
      username?: string;
      role?: string;
      permissions?: string[];
      allowedObjects?: string[];
      deniedObjects?: string[];
      expiresInMinutes?: number;
      metadata?: Record<string, unknown>;
    };
    
    // Generate session ID if not provided
    const sid = sessionId ?? `session_${Date.now()}_${Math.random().toString(36).substring(7)}`;
    
    // If no role specified, try to detect from Clarity user info
    let detectedRole = role;
    if (!detectedRole && !permissions && userId && sharedServices) {
      try {
        const userResp = await sharedServices.clarityClient.get<Record<string, unknown>>(
          `/resources/${userId}?fields=_internalId,userName,isActive`
        );
        if (userResp) {
          // Default to analyst for authenticated Clarity users
          detectedRole = 'analyst';
          console.log(`[API] Auto-detected role for user ${username}: ${detectedRole}`);
        }
      } catch {
        console.log(`[API] Could not detect user role, defaulting to readonly`);
      }
    }
    
    const session = sessionManager.createSession({
      sessionId: sid,
      userId,
      username,
      role: (detectedRole || 'readonly') as 'readonly' | 'analyst' | 'editor' | 'manager' | 'admin',
      permissions: permissions as any,
      allowedObjects,
      deniedObjects,
      expiresInMinutes: expiresInMinutes ?? 60,
      metadata,
    });
    
    res.json({ success: true, session });
  } catch (error) {
    console.error('[API] Session creation error:', error);
    res.status(500).json({ error: error instanceof Error ? error.message : 'Error' });
  }
});

// Get session info
app.get('/api/session/:sessionId', (req, res) => {
  try {
    const { sessionId } = req.params;
    const session = sessionManager.getSession(sessionId!);
    
    if (!session) {
      res.status(404).json({ error: 'Session not found or expired' });
      return;
    }
    
    res.json({ success: true, session });
  } catch (error) {
    console.error('[API] Session get error:', error);
    res.status(500).json({ error: error instanceof Error ? error.message : 'Error' });
  }
});

// End session
app.delete('/api/session/:sessionId', (req, res) => {
  try {
    const { sessionId } = req.params;
    const removed = sessionManager.endSession(sessionId!);
    res.json({ success: removed });
  } catch (error) {
    console.error('[API] Session delete error:', error);
    res.status(500).json({ error: error instanceof Error ? error.message : 'Error' });
  }
});

// Refresh session
app.post('/api/session/:sessionId/refresh', (req, res) => {
  try {
    const { sessionId } = req.params;
    const { extendMinutes } = req.body as { extendMinutes?: number };
    
    const session = sessionManager.refreshSession(sessionId!, extendMinutes ?? 60);
    
    if (!session) {
      res.status(404).json({ error: 'Session not found or expired' });
      return;
    }
    
    res.json({ success: true, session });
  } catch (error) {
    console.error('[API] Session refresh error:', error);
    res.status(500).json({ error: error instanceof Error ? error.message : 'Error' });
  }
});

// ============================================================================
// TOOLS ENDPOINTS
// ============================================================================

// Get available tools for a session
app.get('/api/tools', (req, res) => {
  try {
    const sessionId = (req.query['sessionId'] as string) ?? 'default';
    const toolsInfo = toolRegistry.formatToolsForClient(sessionId);
    res.json({ success: true, ...toolsInfo });
  } catch (error) {
    console.error('[API] Tools get error:', error);
    res.status(500).json({ error: error instanceof Error ? error.message : 'Error' });
  }
});

// Get tools grouped by category
app.get('/api/tools/categories', (req, res) => {
  try {
    const sessionId = (req.query['sessionId'] as string) ?? 'default';
    const grouped = toolRegistry.getToolsByCategory(sessionId);
    res.json({ success: true, categories: grouped });
  } catch (error) {
    console.error('[API] Tools categories error:', error);
    res.status(500).json({ error: error instanceof Error ? error.message : 'Error' });
  }
});

// Check if session can use a tool
app.get('/api/tools/:toolId/check', (req, res) => {
  try {
    const { toolId } = req.params;
    const sessionId = (req.query['sessionId'] as string) ?? 'default';
    
    const result = sessionManager.validateToolAccess(sessionId, toolId!);
    res.json({ success: true, ...result });
  } catch (error) {
    console.error('[API] Tool check error:', error);
    res.status(500).json({ error: error instanceof Error ? error.message : 'Error' });
  }
});

// ============================================================================
// ENHANCED CHAT WITH TOOL VALIDATION
// ============================================================================

// AI Chat endpoint with session validation
app.post('/api/chat/secure', async (req, res) => {
  try {
    const { message, sessionId } = req.body as { message?: string; sessionId?: string };
    
    if (!message || typeof message !== 'string') {
      res.status(400).json({ error: 'Message is required' });
      return;
    }
    
    const sid = sessionId ?? 'default';
    
    // Get session info (create default if doesn't exist)
    let session = sessionManager.getSession(sid);
    if (!session) {
      // Auto-create readonly session for unknown sessions
      session = sessionManager.createSession({
        sessionId: sid,
        role: 'readonly',
        expiresInMinutes: 30,
      });
    }
    
    const services = getServices();
    const response = await services.chatHandler.handleMessage(message, sid);
    
    // Add session info and available tools to response
    res.json({
      ...response,
      session: {
        sessionId: sid,
        permissions: session.permissions,
        allowedTools: session.allowedTools,
      },
    });
  } catch (error) {
    console.error('[API] Secure chat error:', error);
    res.status(500).json({ 
      error: error instanceof Error ? error.message : 'Internal server error',
      timestamp: new Date().toISOString(),
    });
  }
});

// ============================================================================
// START SERVER
// ============================================================================

app.listen(config.port, async () => {
  console.log(`
╔═══════════════════════════════════════════════════════════════╗
║           Clarity PPM MCP Server v3.1.0                       ║
╠═══════════════════════════════════════════════════════════════╣
║  🚀 Server running on port ${config.port}                            ║
║  📡 Clarity URL: ${config.clarityBaseUrl.substring(0, 35).padEnd(35)}     ║
╚═══════════════════════════════════════════════════════════════╝
  `);
  
  // Validate Clarity capabilities at startup
  try {
    const services = getServices();
    console.log('[Startup] Validating Clarity API capabilities...');
    const caps = await toolRegistry.validateCapabilities(services.clarityClient);
    
    console.log(`[Startup] ✅ Capabilities validated:`);
    console.log(`  - Read: ${caps.canRead ? '✅' : '❌'}`);
    console.log(`  - Projects: ${caps.hasProjects ? '✅' : '❌'}`);
    console.log(`  - Tasks: ${caps.hasTasks ? '✅' : '❌'}`);
    console.log(`  - Resources: ${caps.hasResources ? '✅' : '❌'}`);
    console.log(`  - Custom Objects: ${caps.hasCustomObjects ? `✅ (${caps.customObjectCodes.length})` : '❌'}`);
    console.log(`  - Write: ${caps.canWrite ? '✅' : '❌'}`);
  } catch (error) {
    console.error('[Startup] ❌ Failed to validate capabilities:', error);
    console.log('[Startup] Tools will show as unavailable until Clarity is reachable');
  }
  
  // Refresh capabilities every 10 minutes
  setInterval(async () => {
    try {
      if (toolRegistry.needsRefresh()) {
        const services = getServices();
        await toolRegistry.validateCapabilities(services.clarityClient);
        console.log('[Refresh] Capabilities refreshed');
      }
    } catch {
      console.error('[Refresh] Failed to refresh capabilities');
    }
  }, 10 * 60 * 1000);
});
