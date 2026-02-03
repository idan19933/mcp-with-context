// Clarity AI Chat v3.1 - With Session Management, Suggestions & Drill-down

let analytics = null;
let currentAIMessage = null;
let chartJSLoaded = false;
let currentSession = null;
let availableTools = [];

// Try to load Chart.js
function loadChartJS() {
  return new Promise((resolve) => {
    if (typeof Chart !== 'undefined') {
      chartJSLoaded = true;
      resolve(true);
      return;
    }

    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js';
    script.onload = () => { chartJSLoaded = true; resolve(true); };
    script.onerror = () => { chartJSLoaded = false; resolve(false); };
    document.head.appendChild(script);
    
    setTimeout(() => { if (typeof Chart === 'undefined') { chartJSLoaded = false; resolve(false); } }, 3000);
  });
}

async function initAnalytics() {
  await loadChartJS();
  console.log('[Analytics] Chart.js loaded:', chartJSLoaded);
  
  analytics = {
    processResponse(response, container) {
      console.log('[Analytics] Processing response...');
      
      if (!response?.success || !response?.chartData) {
        console.log('[Analytics] No chartData from server');
        return false;
      }
      
      const { groupableFields, chartData, fieldMetadata } = response.chartData;
      
      if (!groupableFields || groupableFields.length === 0) {
        console.log('[Analytics] No groupable fields');
        return false;
      }
      
      console.log('[Analytics] Rendering', groupableFields.length, 'charts');
      
      groupableFields.forEach(fieldName => {
        const data = chartData[fieldName];
        const metadata = fieldMetadata[fieldName];
        
        if (!data || data.length === 0) return;
        
        this.createHTMLChart(data, metadata, container, response.chartData);
      });
      
      return true;
    },
    
    createHTMLChart(data, metadata, container, chartDataFull) {
      const displayName = metadata?.displayName || 'Distribution';
      const total = data.reduce((sum, item) => sum + item.value, 0);
      const maxValue = Math.max(...data.map(d => d.value));
      
      const colors = [
        '#667eea', '#764ba2', '#34d399', '#fb923c', '#ef4444', 
        '#3b82f6', '#a855f7', '#ec4899', '#14b8a6', '#f59e0b'
      ];
      
      const chartDiv = document.createElement('div');
      chartDiv.style.cssText = 'background:#fff;padding:20px;border-radius:12px;margin-top:15px;box-shadow:0 4px 12px rgba(0,0,0,0.15);';
      
      const title = document.createElement('div');
      title.style.cssText = 'font-size:16px;font-weight:bold;margin-bottom:20px;color:#333;text-align:center;';
      title.textContent = `${displayName} Distribution (${total} items)`;
      chartDiv.appendChild(title);
      
      data.forEach((item, i) => {
        const pct = ((item.value / total) * 100).toFixed(1);
        const barPct = (item.value / maxValue) * 100;
        const color = colors[i % colors.length];
        
        const row = document.createElement('div');
        row.style.cssText = 'margin-bottom:12px;cursor:pointer;padding:4px;border-radius:6px;transition:background 0.2s;';
        row.dataset.value = item.label;
        
        row.onmouseenter = () => row.style.background = '#f3f4f6';
        row.onmouseleave = () => row.style.background = 'transparent';
        
        // Click to drill down
        if (chartDataFull?.drillDownEnabled) {
          row.onclick = () => {
            const input = document.getElementById('chat-input');
            input.value = `show me the ${item.label} ones`;
            sendMessage();
          };
        }
        
        const labelRow = document.createElement('div');
        labelRow.style.cssText = 'display:flex;justify-content:space-between;margin-bottom:4px;font-size:13px;';
        
        const displayLabel = item.label || '(No value)';
        labelRow.innerHTML = `<span style="color:#333;font-weight:500;">${escapeHtml(displayLabel)}</span><span style="color:#666;">${item.value} (${pct}%)</span>`;
        row.appendChild(labelRow);
        
        const barBg = document.createElement('div');
        barBg.style.cssText = 'background:#e5e7eb;border-radius:6px;height:24px;overflow:hidden;';
        
        const barFill = document.createElement('div');
        barFill.style.cssText = `background:${color};height:100%;border-radius:6px;width:${barPct}%;transition:width 0.3s ease;`;
        
        barBg.appendChild(barFill);
        row.appendChild(barBg);
        chartDiv.appendChild(row);
      });
      
      // Drill down hint
      if (chartDataFull?.drillDownEnabled) {
        const hint = document.createElement('div');
        hint.style.cssText = 'margin-top:12px;font-size:12px;color:#667eea;text-align:center;';
        hint.textContent = '💡 Click a bar to drill down';
        chartDiv.appendChild(hint);
      }
      
      const summary = document.createElement('div');
      summary.style.cssText = 'margin-top:15px;padding-top:15px;border-top:1px solid #e5e7eb;font-size:12px;color:#666;text-align:center;';
      summary.textContent = `${data.length} categories - ${total} total items`;
      chartDiv.appendChild(summary);
      
      container.appendChild(chartDiv);
    }
  };
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

/**
 * Initialize session from Clarity cookies
 */
async function initSession() {
  try {
    console.log('[Chat] Initializing session...');
    const response = await chrome.runtime.sendMessage({ action: 'initSession' });
    
    if (response.session) {
      currentSession = response.session;
      updateSessionBadge();
      console.log('[Chat] Session:', currentSession.sessionId);
      await loadTools();
    }
  } catch (error) {
    console.error('[Chat] Session init error:', error);
  }
}

/**
 * Load available tools from server (validated against actual Clarity capabilities)
 */
async function loadTools() {
  try {
    const response = await chrome.runtime.sendMessage({ action: 'getTools' });
    if (response?.tools) {
      availableTools = response.tools;
      console.log('[Chat] Tools loaded:', availableTools.length, 'Capabilities:', response.capabilities);
      updateToolsPanel();
      updateWelcomeMessage(response);
    } else {
      updateWelcomeMessage(null);
    }
  } catch (error) {
    console.error('[Chat] Tools error:', error);
    updateWelcomeMessage(null);
  }
}

/**
 * Update the welcome message based on actual available tools & capabilities
 */
function updateWelcomeMessage(toolsResponse) {
  const welcome = document.querySelector('.welcome-message');
  if (!welcome) return;
  
  if (!toolsResponse || !toolsResponse.tools || toolsResponse.tools.length === 0) {
    welcome.innerHTML = `
      <h4>👋 Hello!</h4>
      <p>I'm connected to your Clarity session!<br>
      <span style="color:#ef4444;">⚠️ No tools available. The server may not be able to reach Clarity.</span></p>
    `;
    return;
  }
  
  // Build dynamic examples from the ACTUAL available tools
  const examples = [];
  for (const tool of toolsResponse.tools) {
    if (tool.examples && tool.examples.length > 0) {
      examples.push(tool.examples[0]);
    }
    if (examples.length >= 4) break;
  }
  
  // Build capabilities summary
  const caps = toolsResponse.capabilities || {};
  const available = [];
  if (caps.hasProjects) available.push('Projects');
  if (caps.hasTasks) available.push('Tasks');
  if (caps.hasResources) available.push('Resources');
  if (caps.hasCustomObjects) available.push(`${caps.customObjectCount} Custom Objects`);
  
  const availableText = available.length > 0 
    ? available.join(', ')
    : 'Checking...';
  
  const examplesHtml = examples.length > 0
    ? examples.map(e => `• "${escapeHtml(e)}"`).join('<br>')
    : '• "help"';
  
  const permsList = toolsResponse.permissions || [];
  const canWrite = permsList.includes('write');
  const roleText = canWrite ? '(Read/Write)' : '(Read Only)';
  
  welcome.innerHTML = `
    <h4>👋 Hello!</h4>
    <p><strong>Available:</strong> ${escapeHtml(availableText)}<br>
    <strong>Access:</strong> ${toolsResponse.tools.length} tools ${roleText}<br><br>
    <strong>Try:</strong><br>
    ${examplesHtml}</p>
  `;
}

function updateSessionBadge() {
  const badge = document.getElementById('session-badge');
  if (!badge) return;
  
  if (currentSession) {
    badge.textContent = currentSession.username || 'Connected';
    badge.style.background = 'rgba(76, 175, 80, 0.9)';
  } else {
    badge.textContent = 'Offline';
    badge.style.background = 'rgba(244, 67, 54, 0.9)';
  }
}

function updateToolsPanel() {
  const toolsList = document.getElementById('tools-list');
  if (!toolsList || availableTools.length === 0) return;
  
  const grouped = {};
  for (const tool of availableTools) {
    if (!grouped[tool.category]) grouped[tool.category] = [];
    grouped[tool.category].push(tool);
  }
  
  let html = '';
  for (const [category, tools] of Object.entries(grouped)) {
    html += `<div class="tool-category-title">${category.toUpperCase()}</div>`;
    for (const tool of tools) {
      html += `
        <div class="tool-item" data-example="${tool.examples?.[0] || ''}">
          <span class="tool-icon">${tool.icon}</span>
          <span class="tool-name">${tool.name}</span>
        </div>
      `;
    }
  }
  
  toolsList.innerHTML = html;
  
  toolsList.querySelectorAll('.tool-item').forEach(item => {
    item.onclick = () => {
      const example = item.dataset.example;
      if (example) {
        document.getElementById('chat-input').value = example;
        toggleToolsPanel();
      }
    };
  });
}

function toggleToolsPanel() {
  const panel = document.getElementById('tools-panel');
  if (panel) panel.classList.toggle('open');
}

function injectChatWidget() {
  if (document.getElementById('clarity-ai-chat-container')) return;
  
  const container = document.createElement('div');
  container.id = 'clarity-ai-chat-container';
  
  const button = document.createElement('button');
  button.id = 'clarity-ai-chat-button';
  button.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="white"><path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H6l-2 2V4h16v12z"/><path d="M7 9h2v2H7zm4 0h2v2h-2zm4 0h2v2h-2z"/></svg>';
  
  const chatWindow = document.createElement('div');
  chatWindow.id = 'clarity-ai-chat-window';
  chatWindow.innerHTML = `
    <div class="chat-header">
      <div class="header-left">
        <h3>🤖 Clarity AI</h3>
        <span id="session-badge" class="session-badge">Connecting...</span>
      </div>
      <div class="header-actions">
        <button id="tools-btn" title="Tools">🛠️</button>
        <button class="chat-close">×</button>
      </div>
    </div>
    
    <div id="tools-panel" class="tools-panel">
      <div class="tools-header">
        <span>Available Tools</span>
        <button id="close-tools-btn">×</button>
      </div>
      <div id="tools-list" class="tools-list">
        <div style="padding:20px;color:#666;text-align:center;">Loading tools...</div>
      </div>
    </div>
    
    <div class="chat-messages" id="chat-messages">
      <div class="welcome-message">
        <h4>👋 Hello!</h4>
        <p>I'm connected to your Clarity session!<br>
        Loading available features...</p>
      </div>
    </div>
    
    <div id="suggestions-container" class="suggestions-container"></div>
    
    <div class="chat-input-container">
      <textarea id="chat-input" placeholder="Ask about Clarity..." rows="1"></textarea>
      <button id="chat-send">
        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="white">
          <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/>
        </svg>
      </button>
    </div>
  `;
  
  container.appendChild(button);
  container.appendChild(chatWindow);
  document.body.appendChild(container);
  
  button.onclick = () => { 
    chatWindow.classList.toggle('open'); 
    if (chatWindow.classList.contains('open')) {
      document.getElementById('chat-input').focus();
      if (!currentSession) initSession();
    }
  };
  
  chatWindow.querySelector('.chat-close').onclick = () => chatWindow.classList.remove('open');
  document.getElementById('chat-send').onclick = sendMessage;
  document.getElementById('chat-input').onkeydown = e => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };
  
  document.getElementById('tools-btn').onclick = toggleToolsPanel;
  document.getElementById('close-tools-btn').onclick = toggleToolsPanel;
}

async function sendMessage() {
  const input = document.getElementById('chat-input');
  const message = input.value.trim();
  if (!message) return;
  
  input.value = '';
  addMessage(message, 'user');
  currentAIMessage = addMessage('Thinking...', 'assistant', true);
  
  // Clear suggestions
  const suggestionsContainer = document.getElementById('suggestions-container');
  if (suggestionsContainer) suggestionsContainer.innerHTML = '';
  
  try {
    console.log('[Chat] Sending with session:', currentSession?.sessionId);
    
    // Send through background script
    const data = await chrome.runtime.sendMessage({
      action: 'chat',
      message
    });
    
    console.log('[Chat] Response:', data);
    
    if (currentAIMessage) {
      currentAIMessage.remove();
      currentAIMessage = null;
    }
    
    if (data.error) {
      addMessage(`❌ Error: ${data.error}`, 'assistant');
      return;
    }
    
    const aiDiv = addMessage(data.reply || 'No response', 'assistant');
    
    // Charts
    if (analytics && data.success && data.chartData) {
      analytics.processResponse(data, aiDiv);
    }
    
    // Suggestions
    if (data.suggestions && data.suggestions.length > 0) {
      showSuggestions(data.suggestions);
    }
    
    // Deep link
    if (data.deepLink) {
      addDeepLink(data.deepLink, aiDiv);
    }
    
  } catch (error) {
    console.error('[Chat] Error:', error);
    if (currentAIMessage) currentAIMessage.remove();
    addMessage(`❌ Error: ${error.message}`, 'assistant');
  }
}

function showSuggestions(suggestions) {
  const container = document.getElementById('suggestions-container');
  if (!container) return;
  
  const html = suggestions.map(s => 
    `<button class="suggestion-btn" data-value="${escapeHtml(s.value)}">${escapeHtml(s.label)}</button>`
  ).join('');
  
  container.innerHTML = html;
  
  container.querySelectorAll('.suggestion-btn').forEach(btn => {
    btn.onclick = () => {
      document.getElementById('chat-input').value = btn.dataset.value;
      sendMessage();
    };
  });
}

function addDeepLink(url, container) {
  const linkDiv = document.createElement('div');
  linkDiv.className = 'deep-link';
  linkDiv.innerHTML = `<a href="${url}" target="_blank">🔗 Open in Clarity</a>`;
  container.appendChild(linkDiv);
}

function addMessage(text, sender, isThinking) {
  const container = document.getElementById('chat-messages');
  
  const welcome = container.querySelector('.welcome-message');
  if (welcome && sender === 'user') welcome.remove();
  
  const div = document.createElement('div');
  div.className = 'message ' + sender + (isThinking ? ' thinking' : '');
  
  const content = document.createElement('div');
  content.className = 'message-content';
  
  content.innerHTML = text
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/\n/g, '<br>');
  
  div.appendChild(content);
  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
  
  return div;
}

// Initialize
console.log('[Clarity AI v3.1] Starting...');
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    injectChatWidget();
    initAnalytics();
  });
} else {
  injectChatWidget();
  initAnalytics();
}
