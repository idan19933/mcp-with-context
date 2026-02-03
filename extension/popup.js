// Popup settings script v3.1

document.addEventListener('DOMContentLoaded', async () => {
  const serverUrlInput = document.getElementById('serverUrl');
  const saveBtn = document.getElementById('saveBtn');
  const reconnectBtn = document.getElementById('reconnectBtn');
  const statusDiv = document.getElementById('status');
  
  const serverStatus = document.getElementById('server-status');
  const sessionStatus = document.getElementById('session-status');
  const userStatus = document.getElementById('user-status');
  const permissionsStatus = document.getElementById('permissions-status');
  const toolsList = document.getElementById('tools-list');
  const toolsCount = document.getElementById('tools-count');
  
  // Load saved settings
  const stored = await chrome.storage.sync.get(['serverUrl']);
  serverUrlInput.value = stored.serverUrl || 'https://mcpnew-production.up.railway.app';
  
  // Load session
  const local = await chrome.storage.local.get(['currentSession']);
  if (local.currentSession) updateSessionUI(local.currentSession);
  
  await checkServer();
  await loadTools();
  
  async function checkServer() {
    try {
      const response = await fetch(`${serverUrlInput.value.trim()}/health`);
      if (response.ok) {
        const data = await response.json();
        serverStatus.textContent = `Connected (${data.version || 'OK'})`;
        serverStatus.className = 'status-value connected';
      } else {
        throw new Error('Server error');
      }
    } catch {
      serverStatus.textContent = 'Disconnected';
      serverStatus.className = 'status-value disconnected';
    }
  }
  
  function updateSessionUI(session) {
    if (session) {
      sessionStatus.textContent = session.sessionId ? session.sessionId.substring(0, 12) + '...' : 'Active';
      userStatus.textContent = session.username || 'Unknown';
      permissionsStatus.textContent = session.permissions ? `${session.permissions.length} perms` : '-';
    } else {
      sessionStatus.textContent = 'None';
      userStatus.textContent = '-';
      permissionsStatus.textContent = '-';
    }
  }
  
  async function loadTools() {
    try {
      const response = await chrome.runtime.sendMessage({ action: 'getTools' });
      
      if (response?.tools?.length > 0) {
        toolsCount.textContent = response.tools.length;
        
        toolsList.innerHTML = response.tools.slice(0, 8).map(tool => `
          <div class="tool-item">
            <span>${tool.icon}</span>
            <span>${tool.name}</span>
          </div>
        `).join('');
        
        if (response.tools.length > 8) {
          toolsList.innerHTML += `<div style="color:#999;font-size:11px;padding:4px 0;">+${response.tools.length - 8} more</div>`;
        }
      } else {
        toolsCount.textContent = '0';
        toolsList.innerHTML = '<div style="color:#999;font-size:12px;">No tools</div>';
      }
    } catch {
      toolsList.innerHTML = '<div style="color:#f44336;font-size:12px;">Error</div>';
    }
  }
  
  function showStatus(message, type) {
    statusDiv.textContent = message;
    statusDiv.className = `status ${type}`;
    setTimeout(() => statusDiv.className = 'status', 3000);
  }
  
  saveBtn.addEventListener('click', async () => {
    const serverUrl = serverUrlInput.value.trim();
    if (!serverUrl) return showStatus('Enter URL', 'error');
    
    await chrome.storage.sync.set({ serverUrl });
    await chrome.runtime.sendMessage({ action: 'updateConfig', serverUrl });
    showStatus('✅ Saved!', 'success');
    await checkServer();
  });
  
  reconnectBtn.addEventListener('click', async () => {
    reconnectBtn.textContent = '...';
    reconnectBtn.disabled = true;
    
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab) {
        const response = await chrome.runtime.sendMessage({ action: 'initSession', tabId: tab.id });
        if (response.session) {
          updateSessionUI(response.session);
          showStatus('✅ Connected!', 'success');
          await loadTools();
        } else {
          showStatus(response.error || 'Failed', 'error');
        }
      }
    } catch (e) {
      showStatus('Error: ' + e.message, 'error');
    } finally {
      reconnectBtn.textContent = 'Reconnect';
      reconnectBtn.disabled = false;
    }
  });
});
