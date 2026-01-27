# Clarity PPM MCP Server v3.0

A comprehensive AI-powered server for CA Clarity PPM with conversation memory, drill-down capabilities, and smart suggestions.

## 🚀 Features

### AI Chat with Memory
- Natural language queries about your Clarity data
- **Conversation context** - remembers previous queries
- **Drill-down** - click on chart values to see details
- **Smart suggestions** - contextual follow-up actions

### Example Conversation
```
User: "Show distribution of projects by status"
AI: 📊 Projects by Status (100 records)
    • Active: 50 (50%)
    • Completed: 30 (30%)
    • On Hold: 20 (20%)
    
    💡 Try: "Show me the Active ones"

User: "Show me the active ones"
AI: 🔍 Projects where Status = "Active" (50 records)
    • Project Alpha
    • Project Beta
    • ...
    
    🔗 Open in Clarity: [link]

User: "Give me a link"
AI: 🔗 https://clarity.company.com/pm/#/projects?filter=status=Active
```

## 📦 Installation

### 1. Clone and Install
```bash
git clone <your-repo>
cd clarity-mcp-server
npm install
```

### 2. Configure Environment
```bash
cp .env.example .env
# Edit .env with your settings
```

Required environment variables:
- `CLARITY_BASE_URL` - Your Clarity REST API URL
- `CLARITY_USERNAME` / `CLARITY_PASSWORD` - Credentials
- `ANTHROPIC_API_KEY` - For AI chat functionality

### 3. Build and Run
```bash
npm run build
npm start
```

## 🔧 API Endpoints

### POST /api/chat
AI-powered chat endpoint.

**Request:**
```json
{
  "message": "Show distribution of projects by status",
  "sessionId": "user-123"  // Optional, for conversation memory
}
```

**Response:**
```json
{
  "success": true,
  "reply": "📊 Projects by Status...",
  "chartData": { ... },
  "suggestions": [
    { "label": "🔍 Show me the Active ones", "value": "show me the active ones" }
  ],
  "deepLink": "https://...",
  "timestamp": "2024-01-27T12:00:00Z"
}
```

### GET /api/objects/custom
List all custom objects in Clarity.

### GET /api/objects/:objectType/metadata
Get metadata for a specific object type.

### GET /api/clarity/*
Proxy requests to Clarity REST API.

### GET /health
Health check endpoint.

## 🌐 Deploying to Railway

1. Push to GitHub
2. Connect Railway to your repo
3. Add environment variables in Railway dashboard
4. Deploy!

## 📁 Project Structure

```
src/
├── index.ts                    # Express server
├── aiChatHandler.ts            # AI chat with context
├── constants.ts                # Configuration constants
├── services/
│   ├── ClarityApiClient.ts     # HTTP client for Clarity
│   ├── MetadataService.ts      # Object/field discovery
│   ├── LookupService.ts        # Lookup value resolution
│   ├── ContextService.ts       # Conversation memory
│   ├── DeepLinkService.ts      # Clarity URL generation
│   └── SuggestionService.ts    # Smart suggestions
└── types/
    ├── clarity.ts              # Clarity type definitions
    └── context.ts              # Context type definitions
```

## 🔄 Version History

### v3.0.0 (Current)
- ✨ Conversation context (memory across messages)
- ✨ Drill-down from charts
- ✨ Smart suggestions
- ✨ Deep links to Clarity
- ✨ Better error handling

### v2.0.0
- AI-powered chat with Claude
- Dynamic metadata discovery
- Chart generation

### v1.0.0
- Basic MCP server
- CRUD operations
