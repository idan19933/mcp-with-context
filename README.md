# Clarity PPM MCP Server v3.1

AI-powered chat assistant for CA Clarity PPM with conversation memory, dynamic tools, and visual analytics.

## 🚀 Features

- **AI Chat with Claude** - Natural language queries for Clarity data
- **Conversation Memory** - Remembers context across messages
- **Drill-down from Charts** - Click chart values to filter data
- **Smart Suggestions** - Context-aware follow-up actions
- **Deep Links** - Direct links to Clarity pages
- **Dynamic Tools** - Permissions-based tool availability
- **Session Management** - Secure sessions from Clarity cookies

## 📁 Project Structure

```
├── src/                    # Server source code
│   ├── index.ts           # Express server & API endpoints
│   ├── aiChatHandler.ts   # AI chat logic with Claude
│   ├── constants.ts       # Configuration constants
│   ├── services/
│   │   ├── ClarityApiClient.ts   # HTTP client for Clarity
│   │   ├── MetadataService.ts    # Object/field discovery
│   │   ├── LookupService.ts      # Lookup value resolution
│   │   ├── ContextService.ts     # Conversation memory
│   │   ├── DeepLinkService.ts    # URL generation
│   │   └── SuggestionService.ts  # Smart suggestions
│   ├── tools/
│   │   ├── ToolRegistry.ts       # Dynamic tool management
│   │   └── SessionManager.ts     # Session & permissions
│   └── types/
│       ├── clarity.ts     # Clarity API types
│       └── context.ts     # Context/session types
├── extension/             # Chrome Extension
│   ├── manifest.json
│   ├── background.js      # Session extraction
│   ├── content.js         # Chat widget
│   ├── styles.css
│   ├── popup.html
│   └── popup.js
├── package.json
├── tsconfig.json
└── README.md
```

## 🛠️ Installation

### Server (Railway/Node.js)

1. **Clone the repository:**
```bash
git clone https://github.com/idan19933/mcp-with-context.git
cd mcp-with-context
```

2. **Install dependencies:**
```bash
npm install
```

3. **Configure environment variables:**
```bash
cp .env.example .env
# Edit .env with your settings
```

4. **Build and run:**
```bash
npm run build
npm start
```

### Chrome Extension

1. Open Chrome → `chrome://extensions/`
2. Enable **Developer mode**
3. Click **Load unpacked**
4. Select the `extension/` folder

## ⚙️ Environment Variables

| Variable | Description | Example |
|----------|-------------|---------|
| `CLARITY_BASE_URL` | Clarity REST API URL | `http://clarity.example.com/ppm/rest/v1` |
| `CLARITY_USERNAME` | Clarity username | `admin` |
| `CLARITY_PASSWORD` | Clarity password | `password` |
| `ANTHROPIC_API_KEY` | Claude API key | `sk-ant-...` |
| `PORT` | Server port | `3000` |

## 📡 API Endpoints

### Chat
- `POST /api/chat` - Send message (open)
- `POST /api/chat/secure` - Send message with session

### Sessions
- `POST /api/session` - Create session
- `GET /api/session/:id` - Get session info
- `DELETE /api/session/:id` - End session
- `POST /api/session/:id/refresh` - Extend session

### Tools
- `GET /api/tools?sessionId=xxx` - Get available tools
- `GET /api/tools/categories?sessionId=xxx` - Tools by category

### Clarity
- `GET /api/objects/custom` - List custom objects
- `GET /api/objects/:type/metadata` - Get object metadata
- `GET /api/clarity/*` - Proxy to Clarity API

### Health
- `GET /health` - Server health check

## 🔐 Permission Levels

| Role | Permissions |
|------|-------------|
| `readonly` | read |
| `analyst` | read, analyze, export |
| `editor` | read, analyze, write |
| `manager` | read, analyze, write, export, custom_objects |
| `admin` | All permissions |

## 💬 Usage Examples

### Natural Language Queries
```
"Show me project distribution by status"
"List all active tasks in project X"
"Create a chart of resources by department"
"How many custom objects do we have?"
```

### Follow-up Actions
```
User: "Show distribution by status"
AI: [Chart with Active: 50, Completed: 30]

User: "Show me the active ones"
AI: [Filtered list of 50 Active records + link]
```

## 🔧 Development

```bash
# Run in development mode
npm run dev

# Build for production
npm run build

# Type check
npx tsc --noEmit
```

## 📦 Deployment to Railway

1. Push to GitHub
2. Connect repo in Railway
3. Set environment variables
4. Deploy!

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Submit a pull request

## 📄 License

MIT License
