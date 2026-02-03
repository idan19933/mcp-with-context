// Background Service Worker for Clarity AI Extension v3.1
// Handles session management and cookie extraction

// Configuration
const CONFIG = {
  API_URL: 'https://mcpnew-production.up.railway.app',
  SESSION_REFRESH_INTERVAL: 25 * 60 * 1000, // 25 minutes
};

// Session state
let currentSession = null;
let clarityInfo = null;

/**
 * Extract JSESSIONID and user info from Clarity cookies
 */
async function extractClaritySession(tabId) {
  try {
    const tab = await chrome.tabs.get(tabId);
    const url = new URL(tab.url);
    
    // Get all cookies from this domain
    const cookies = await chrome.cookies.getAll({ domain: url.hostname });
    
    // Find JSESSIONID
    const sessionCookie = cookies.find(c => c.name === 'JSESSIONID');
    
    // Try to find username from cookies
    const userCookie = cookies.find(c => 
      c.name.toLowerCase().includes('username') || 
      c.name.toLowerCase().includes('user')
    );
    
    console.log('[Background] Cookies found:', cookies.map(c => c.name).join(', '));
    console.log('[Background] JSESSIONID:', sessionCookie ? 'Found' : 'Not found');
    
    return {
      jsessionId: sessionCookie?.value,
      username: userCookie?.value || 'clarity_user',
      clarityDomain: url.hostname,
      clarityUrl: url.origin,
      pageUrl: tab.url,
    };
  } catch (error) {
    console.error('[Background] Error extracting session:', error);
    return null;
  }
}

/**
 * Create a session on the server
 * Role is determined by Clarity user info, not hardcoded
 */
async function createServerSession(info) {
  try {
    const stored = await chrome.storage.sync.get(['serverUrl']);
    const apiUrl = stored.serverUrl || CONFIG.API_URL;
    
    // Generate session ID from JSESSIONID or random
    const sessionId = info?.jsessionId 
      ? `clarity_${info.jsessionId.substring(0, 16)}`
      : `browser_${Date.now()}_${Math.random().toString(36).substring(7)}`;
    
    console.log('[Background] Creating session:', sessionId);
    
    // First: try to get user info from Clarity to determine real role
    let userRole = null;
    let userId = null;
    let userGroups = [];
    
    if (info?.jsessionId && info?.clarityUrl) {
      try {
        const userResp = await fetch(
          `${info.clarityUrl}/ppm/rest/v1/resources?filter=((userName = '${info.username}'))&fields=_internalId,userName,fullName,isActive&limit=1`,
          { 
            headers: { 'Cookie': `JSESSIONID=${info.jsessionId}` },
            credentials: 'include',
          }
        );
        
        if (userResp.ok) {
          const userData = await userResp.json();
          const user = userData._results?.[0];
          if (user) {
            userId = String(user._internalId);
            console.log('[Background] Found Clarity user:', user.fullName || user.userName);
          }
        }
      } catch (e) {
        console.log('[Background] Could not fetch Clarity user info:', e.message);
      }
    }
    
    // Create session on our MCP server - let the server determine the role
    // by passing Clarity user info instead of hardcoded role
    const response = await fetch(`${apiUrl}/api/session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId,
        userId: userId || undefined,
        username: info?.username || 'unknown',
        // Don't hardcode role - let server determine from user info
        // If we couldn't detect, server defaults to 'readonly'
        role: userRole || undefined,
        metadata: {
          clarityDomain: info?.clarityDomain,
          hasJsessionId: !!info?.jsessionId,
          userGroups,
        },
        expiresInMinutes: 60,
      }),
    });
    
    if (!response.ok) {
      throw new Error(`Server returned ${response.status}`);
    }
    
    const data = await response.json();
    currentSession = data.session;
    clarityInfo = info;
    
    await chrome.storage.local.set({ 
      currentSession: data.session,
      clarityInfo: info,
    });
    
    console.log('[Background] Session created:', currentSession.sessionId, 'permissions:', currentSession.permissions);
    return currentSession;
  } catch (error) {
    console.error('[Background] Error creating session:', error);
    
    // Fallback - minimal readonly session, no hardcoded tools
    const fallbackSession = {
      sessionId: `local_${Date.now()}`,
      username: info?.username || 'unknown',
      permissions: ['read'],
      allowedTools: [], // Empty - will be loaded from server
    };
    
    currentSession = fallbackSession;
    await chrome.storage.local.set({ currentSession: fallbackSession });
    
    return fallbackSession;
  }
}

/**
 * Get available tools for the session
 */
async function getAvailableTools() {
  try {
    const stored = await chrome.storage.sync.get(['serverUrl']);
    const apiUrl = stored.serverUrl || CONFIG.API_URL;
    const sessionId = currentSession?.sessionId || 'default';
    
    const response = await fetch(`${apiUrl}/api/tools?sessionId=${sessionId}`);
    
    if (!response.ok) throw new Error(`Server returned ${response.status}`);
    
    return await response.json();
  } catch (error) {
    console.error('[Background] Error getting tools:', error);
    return { tools: [], permissions: ['read'] };
  }
}

/**
 * Send chat message with session
 */
async function sendChatMessage(message) {
  try {
    const stored = await chrome.storage.sync.get(['serverUrl']);
    const apiUrl = stored.serverUrl || CONFIG.API_URL;
    const sessionId = currentSession?.sessionId || 'default';
    
    console.log('[Background] Chat with session:', sessionId);
    
    const response = await fetch(`${apiUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, sessionId }),
    });
    
    if (!response.ok) throw new Error(`Server returned ${response.status}`);
    
    return await response.json();
  } catch (error) {
    console.error('[Background] Chat error:', error);
    return { error: error.message };
  }
}

/**
 * Refresh the session
 */
async function refreshSession() {
  if (!currentSession?.sessionId) return null;
  
  try {
    const stored = await chrome.storage.sync.get(['serverUrl']);
    const apiUrl = stored.serverUrl || CONFIG.API_URL;
    
    const response = await fetch(
      `${apiUrl}/api/session/${currentSession.sessionId}/refresh`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ extendMinutes: 60 }),
      }
    );
    
    if (response.ok) {
      const data = await response.json();
      currentSession = data.session;
      await chrome.storage.local.set({ currentSession: data.session });
    }
    
    return currentSession;
  } catch (error) {
    console.error('[Background] Refresh error:', error);
    return null;
  }
}

// Message handlers
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  (async () => {
    console.log('[Background] Message:', request.action);
    
    switch (request.action) {
      case 'getSession':
        if (!currentSession) {
          const stored = await chrome.storage.local.get(['currentSession']);
          currentSession = stored.currentSession;
        }
        sendResponse({ session: currentSession });
        break;
        
      case 'initSession':
        const tabId = sender.tab?.id || request.tabId;
        if (tabId) {
          const info = await extractClaritySession(tabId);
          const session = await createServerSession(info);
          sendResponse({ session, clarityInfo: info });
        } else {
          const session = await createServerSession({ username: 'unknown' });
          sendResponse({ session });
        }
        break;
        
      case 'getTools':
        const tools = await getAvailableTools();
        sendResponse(tools);
        break;
        
      case 'chat':
        const chatResponse = await sendChatMessage(request.message);
        sendResponse(chatResponse);
        break;
        
      case 'refreshSession':
        const refreshed = await refreshSession();
        sendResponse({ session: refreshed });
        break;
        
      case 'updateConfig':
        if (request.serverUrl) {
          await chrome.storage.sync.set({ serverUrl: request.serverUrl });
          CONFIG.API_URL = request.serverUrl;
        }
        sendResponse({ success: true });
        break;
        
      case 'log':
        console.log('[Background]', request.message);
        sendResponse({ ok: true });
        break;
        
      default:
        sendResponse({ error: 'Unknown action' });
    }
  })();
  
  return true;
});

// Initialize
chrome.runtime.onInstalled.addListener(async () => {
  console.log('[Background] Clarity AI v3.1 installed');
  
  const stored = await chrome.storage.local.get(['currentSession']);
  if (stored.currentSession) {
    currentSession = stored.currentSession;
  }
});

// Refresh session periodically
setInterval(refreshSession, CONFIG.SESSION_REFRESH_INTERVAL);
