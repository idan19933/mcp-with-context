/**
 * Clarity PPM MCP Server v3.0
 * 
 * Features:
 * - AI Chat with Claude
 * - Conversation Context (memory)
 * - Drill-down from charts
 * - Smart suggestions
 * - Deep links to Clarity
 */

import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';

import { ClarityApiClient, createClarityClient } from './services/ClarityApiClient.js';
import { MetadataService } from './services/MetadataService.js';
import { LookupService } from './services/LookupService.js';
import { AIChatHandler } from './aiChatHandler.js';

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
  res.json({ 
    status: 'ok', 
    version: '3.0.0',
    features: ['ai-chat', 'context-memory', 'drill-down', 'suggestions', 'deep-links'],
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
    const endpoint = '/' + req.params[0];
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
    const endpoint = '/' + req.params[0];
    const services = getServices();
    const data = await services.clarityClient.post(endpoint, req.body);
    res.json(data);
  } catch (error) {
    console.error('[API] Clarity proxy error:', error);
    res.status(500).json({ error: error instanceof Error ? error.message : 'Error' });
  }
});

// ============================================================================
// START SERVER
// ============================================================================

app.listen(config.port, () => {
  console.log(`
╔═══════════════════════════════════════════════════════════════╗
║           Clarity PPM MCP Server v3.0.0                       ║
╠═══════════════════════════════════════════════════════════════╣
║  🚀 Server running on port ${config.port}                            ║
║  📡 Clarity URL: ${config.clarityBaseUrl.substring(0, 35).padEnd(35)}     ║
║                                                               ║
║  Features:                                                    ║
║  ✅ AI Chat with Claude                                       ║
║  ✅ Conversation Context (memory)                             ║
║  ✅ Drill-down from charts                                    ║
║  ✅ Smart suggestions                                         ║
║  ✅ Deep links to Clarity                                     ║
║                                                               ║
║  Endpoints:                                                   ║
║  POST /api/chat          - AI chat                            ║
║  GET  /api/objects/custom - List custom objects               ║
║  GET  /api/clarity/*     - Proxy to Clarity API               ║
║  GET  /health            - Health check                       ║
╚═══════════════════════════════════════════════════════════════╝
  `);
});
