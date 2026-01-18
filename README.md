# Antigravity to OpenAI API Proxy Service

This project converts the Google Antigravity API into an OpenAI-compatible proxy service. It supports streaming responses, tool calls, and multi-account management.

## Features

- ✅ OpenAI API compatible format
- ✅ Streaming and non-streaming responses
- ✅ Structured JSON output support (`response_format`)
- ✅ Tool calling (Function Calling) support
- ✅ Multi-account automatic rotation (multiple strategies)
- ✅ Automatic Token refresh
- ✅ API Key authentication
- ✅ Thinking output compatible with OpenAI `reasoning_effort` and DeepSeek `reasoning_content`
- ✅ Image input support (Base64)
- ✅ Image generation support (`gemini-3-pro-image`)
- ✅ Random ProjectId for Pro accounts
- ✅ Model quota display (real-time remaining quota and reset time)
- ✅ SD WebUI API compatibility (txt2img/img2img)
- ✅ Heartbeat mechanism (prevents Cloudflare timeout disconnects)
- ✅ Model list caching (reduces API calls)
- ✅ Eligibility check fallback (auto-generate random ProjectId when ineligible)
- ✅ True system message merge (initial consecutive `system` messages merged into SystemInstruction)
- ✅ Privacy mode (auto-hide sensitive info)
- ✅ Memory optimization (reduce 8+ processes to 2; memory from 100MB+ to 50MB+)
- ✅ Object pool reuse (50%+ fewer temporary objects; lower GC frequency)
- ✅ Signature passthrough control (configurable thoughtSignature passthrough)
- ✅ Prebuilt binaries (Windows/Linux/Android; no Node.js required)
- ✅ Multiple API formats (OpenAI, Gemini, Claude)
- ✅ Converter reuse (shared modules, less duplication)
- ✅ Dynamic memory thresholds (calculated from user config)

## Requirements

- Node.js >= 18.0.0

## Quick Start

### Option 1: One-Click Setup Script (Recommended)

**Windows (cmd.exe):**
```bash
curl -O https://raw.githubusercontent.com/liuw1535/antigravity2api-nodejs/main/setup.bat && setup.bat
```

**Windows (PowerShell):**
```powershell
IwR -Uri https://raw.githubusercontent.com/liuw1535/antigravity2api-nodejs/main/setup.bat -OutFile setup.bat; .\setup.bat
```

**Linux/macOS:**
```bash
wget https://raw.githubusercontent.com/liuw1535/antigravity2api-nodejs/main/setup.sh && chmod +x setup.sh && ./setup.sh
```

Or use curl:
```bash
curl -O https://raw.githubusercontent.com/liuw1535/antigravity2api-nodejs/main/setup.sh && chmod +x setup.sh && ./setup.sh
```

The script will automatically:
1. Clone the repository
2. Install dependencies
3. Copy configuration files
4. Configure admin credentials (interactive)
5. Start the service

### Quick Start (Already Deployed)

If you already deployed the project, use the start script:

**Windows:**
```bash
start.bat
```

**Linux/macOS:**
```bash
chmod +x start.sh
./start.sh
```

### Updating

Use the update script to safely update to the latest version (it automatically stashes local changes):

**Windows:**
```bash
update.bat
```

**Linux/macOS:**
```bash
chmod +x update.sh
./update.sh
```

After the update:
- Restore local changes: `git stash pop`
- Discard local changes: `git stash drop`

### Option 2: Manual Setup

#### 1. Install dependencies

```bash
npm install
```

#### 2. Configure environment variables

On first startup, if `.env` and `config.json` do not exist, defaults are created automatically.

You can also copy the example files manually:

```bash
cp .env.example .env
cp config.json.example config.json
```

Edit `.env` with required parameters:

```env
# Required (leave blank to auto-generate random credentials)
API_KEY=sk-text
ADMIN_USERNAME=admin
ADMIN_PASSWORD=admin123
JWT_SECRET=your-jwt-secret-key-change-this-in-production

# Optional
# PROXY=http://127.0.0.1:7890
# SYSTEM_INSTRUCTION=You are a chatbot
# IMAGE_BASE_URL=http://your-domain.com
```

#### 3. Log in to obtain Tokens

```bash
npm run login
```

Your browser will open the Google authorization page. After authorization, tokens are saved to `data/accounts.json`.

#### 4. Start the service

```bash
npm start
```

The service starts at `http://localhost:8045`.

## Binary Deployment (Recommended)

No Node.js installation required. Download and run the prebuilt binaries.

### Download binaries

Download the binary for your platform from [GitHub Releases](https://github.com/ZhaoShanGeng/antigravity2api-nodejs/releases):

| Platform | Filename |
|------|--------|
| Windows x64 | `antigravity2api-win-x64.exe` |
| Linux x64 | `antigravity2api-linux-x64` |
| Linux ARM64 | `antigravity2api-linux-arm64` |
| macOS x64 | `antigravity2api-macos-x64` |
| macOS ARM64 | `antigravity2api-macos-arm64` |

### Prepare configuration files

Place the following in the same directory as the binary:

```
├── antigravity2api-win-x64.exe  # Binary
├── .env                          # Environment config (optional; created on first run)
├── config.json.example           # Config template (required)
├── public/                       # Static files (required)
│   ├── index.html
│   ├── style.css
│   ├── assets/
│   │   └── bg.jpg
│   └── js/
│       ├── auth.js
│       ├── config.js
│       ├── main.js
│       ├── quota.js
│       ├── tokens.js
│       ├── ui.js
│       └── utils.js
└── data/                         # Data directory (auto-created)
    └── accounts.json
```

### Configure environment variables

Create a `.env` file:

```env
API_KEY=sk-your-api-key
ADMIN_USERNAME=admin
ADMIN_PASSWORD=admin123
JWT_SECRET=your-jwt-secret-key-change-this-in-production
# IMAGE_BASE_URL=http://your-domain.com
# PROXY=http://127.0.0.1:7890
```

### Run

**Windows:**
```bash
# Double-click the binary or run from the command line
antigravity2api-win-x64.exe
```

**Linux/macOS:**
```bash
# Add execute permission
chmod +x antigravity2api-linux-x64

# Run
./antigravity2api-linux-x64
```

### Binary deployment notes

- **No Node.js required**: binaries include the Node.js runtime
- **Auto config**: on first start, `config.json` is created from `config.json.example`
- **Config files**: `config.json.example` must be in the same directory as the binary
- **Static files**: `public/` must be in the same directory as the binary
- **Data persistence**: `data/` is created automatically for token storage
- **Cross-platform**: Windows/Linux/macOS (x64 and ARM64)

### Run as a system service (Linux)

Create a systemd service file at `/etc/systemd/system/antigravity2api.service`:

```ini
[Unit]
Description=Antigravity2API Service
After=network.target

[Service]
Type=simple
User=www-data
WorkingDirectory=/opt/antigravity2api
ExecStart=/opt/antigravity2api/antigravity2api-linux-x64
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

Start the service:

```bash
sudo systemctl daemon-reload
sudo systemctl enable antigravity2api
sudo systemctl start antigravity2api
```

## Docker Deployment

### Docker Compose (Recommended)

1. **One-click build**

```bash
npm run docker:build
```

This command will:
- Create `.env` from `.env.example` if it does not exist
- Create `config.json` from `config.json.example` if it does not exist
- Create required directories (`data/`, `public/images/`)
- Run `docker-compose build`

2. **Start service**

```bash
docker compose up -d
```

3. **View logs**

```bash
docker compose logs -f
```

4. **Stop service**

```bash
docker compose down
```

### Manual build

If you prefer manual build, prepare configuration first:

```bash
# Copy config files
cp .env.example .env
cp config.json.example config.json

# Create required directories
mkdir -p data public/images

# Build image
docker build -t antigravity2api .
```

2. **Run container**

```bash
docker run -d \
  --name antigravity2api \
  -p 8045:8045 \
  -e API_KEY=sk-text \
  -e ADMIN_USERNAME=admin \
  -e ADMIN_PASSWORD=admin123 \
  -e JWT_SECRET=your-jwt-secret-key \
  -e IMAGE_BASE_URL=http://your-domain.com \
  -v $(pwd)/data:/app/data \
  -v $(pwd)/public/images:/app/public/images \
  -v $(pwd)/.env:/app/.env \
  -v $(pwd)/config.json:/app/config.json \
  antigravity2api
```

3. **View logs**

```bash
docker logs -f antigravity2api
```

### Docker deployment notes

- Data persistence: mount `data/` to store tokens
- Image storage: mount `public/images/` to store generated images
- Config files: mount `.env` and `config.json` for hot reloads
- Port mapping: defaults to port 8045
- Auto-restart: container will restart after unexpected exit

## Zeabur Deployment

### Deploy with prebuilt image

1. **Create a service**

Create a new service in the Zeabur console using the following image:

```
ghcr.io/liuw1535/antigravity2api-nodejs
```

2. **Configure environment variables**

Add these variables in the service settings:

| Environment variable | Description | Example |
|--------|------|--------|
| `API_KEY` | API authentication key | `sk-your-api-key` |
| `ADMIN_USERNAME` | Admin username | `admin` |
| `ADMIN_PASSWORD` | Admin password | `your-secure-password` |
| `JWT_SECRET` | JWT secret | `your-jwt-secret-key` |
| `IMAGE_BASE_URL` | Base URL for images | `https://your-domain.zeabur.app` |

Optional variables:
- `PROXY`: proxy URL
- `SYSTEM_INSTRUCTION`: system prompt

3. **Configure persistent storage**

Add these volume mounts in the **Volumes** settings:

| Mount path | Description |
|---------|------|
| `/app/data` | Token storage |
| `/app/public/images` | Generated images |

⚠️ **Important:**
- Only mount `/app/data` and `/app/public/images`
- Do not mount other paths (e.g., `/app/.env`, `/app/config.json`), or required config files will be cleared and the app will fail to start

4. **Bind a domain**

Bind a domain in **Networking**, then set it in `IMAGE_BASE_URL`.

5. **Start the service**

After saving, Zeabur will pull the image and start the service. Access it via the bound domain.

### Zeabur deployment notes

- Uses prebuilt Docker images; no manual build required
- Configure all required parameters via environment variables
- Persistent storage keeps token and image data safe

## Web Admin UI

After startup, open `http://localhost:8045` to access the admin UI.

### Features

- 🔐 **Secure login**: JWT Token authentication protects admin endpoints
- 📊 **Real-time stats**: total token count and enabled/disabled status
- ➕ **Multiple ways to add tokens**:
  - OAuth login (recommended): completes Google OAuth flow automatically
  - Manual entry: input Access Token and Refresh Token directly
- 🎯 **Token management**:
  - View full Token details (Access Token suffix, Project ID, expiry)
  - 📊 View model quota: grouped by type (Claude/Gemini/Other) with remaining quota and reset time
  - One-click enable/disable
  - Delete invalid Tokens
  - Refresh Token list in real time
- ⚙️ **Configuration management**:
  - Edit server config online (port, listen address)
  - Tune defaults (temperature, Top P/K, max tokens)
  - Update security settings (API key, request size limit)
  - Configure optional settings such as proxy and system prompts
  - Hot reload (some settings require restart)

### Workflow

1. **Log in**
   - Use `ADMIN_USERNAME` and `ADMIN_PASSWORD` from `.env`
   - JWT is stored in the browser after login

2. **Add Token**
   - **OAuth method** (recommended):
     1. Click **OAuth Login**
     2. Click **Open Authorization Page** in the modal
     3. Complete Google authorization in a new window
     4. Copy the full callback URL from the browser
     5. Paste into the input and submit
   - **Manual method**:
     1. Click **Manual Entry**
     2. Fill Access Token, Refresh Token, and expiry
     3. Submit

3. **Manage Tokens**
   - Review token cards for status and details
   - Click **📊 View Quota** to see model quotas for that account
     - Auto-grouped by model type (Claude/Gemini/Other)
     - Shows remaining quota percentage and progress bars
     - Shows quota reset time (Beijing time)
     - Supports **Refresh Now** to force refresh
   - Use **Enable/Disable** to control token status
   - Use **Delete** to remove invalid tokens
   - Click **Refresh** to update the list

4. **Privacy mode**
   - Enabled by default, automatically hides Token/Project ID and other sensitive info
   - Click **Show sensitive info** to toggle visibility
   - Supports per-item and bulk display

5. **Configure rotation strategy**
   - Supported strategies:
     - `round_robin`: balance load by switching tokens per request
     - `quota_exhausted`: switch only when quota runs out
     - `request_count`: switch after a custom number of requests
   - Configure in the **Settings** page

6. **Update config**
   - Switch to the **Settings** tab
   - Update desired settings
   - Click **Save Configuration** to apply
   - Note: port/host changes require a restart
   - Supported settings:
     - Token info (Access Token, Refresh Token)
     - Thinking budget (1024–32000)
     - Image base URL
     - Rotation strategy
     - Memory threshold
     - Heartbeat interval
     - Font size

### UI Preview

- **Token management page**: card-based layout with quick actions
- **Settings page**: categorized configuration sections with inline edits
- **Responsive design**: works on desktop and mobile
- **Font optimization**: MiSans + Ubuntu Mono for readability

## API Usage

The service provides OpenAI-compatible APIs. See [API.md](API.md) for details.

### Quick test

```bash
curl http://localhost:8045/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer sk-text" \
  -d '{
    "model": "gemini-2.0-flash-exp",
    "messages": [{"role": "user", "content": "Hello"}]
  }'
```

## Multi-account management

`data/accounts.json` supports multiple accounts, and the service rotates them automatically:

```json
[
  {
    "access_token": "ya29.xxx",
    "refresh_token": "1//xxx",
    "expires_in": 3599,
    "timestamp": 1234567890000,
    "enable": true
  },
  {
    "access_token": "ya29.yyy",
    "refresh_token": "1//yyy",
    "expires_in": 3599,
    "timestamp": 1234567890000,
    "enable": true
  }
]
```

- `enable: false` disables an account
- Expired tokens are refreshed automatically
- Refresh failures (403) disable the token and switch to the next account

## Configuration

The project configuration has two parts:

### 1. config.json (base config)

This file includes server, API, and default parameter settings.

On first startup, if `config.json` does not exist, a default copy is created from `config.json.example`.

Example:

```json
{
  "server": {
    "port": 8045,              // Service port
    "host": "0.0.0.0",         // Listen address
    "maxRequestSize": "500mb", // Max request size
    "heartbeatInterval": 15000,// Heartbeat interval (ms) to avoid Cloudflare timeouts
    "memoryThreshold": 100     // Memory threshold (MB) before GC
  },
  "rotation": {
    "strategy": "round_robin", // Rotation: round_robin/quota_exhausted/request_count
    "requestCount": 50         // Requests per token in request_count mode
  },
  "defaults": {
    "temperature": 1,          // Default temperature
    "topP": 1,                 // Default top_p
    "topK": 50,                // Default top_k
    "maxTokens": 32000,        // Default max tokens
    "thinkingBudget": 1024     // Default thinking budget (1024–32000)
  },
  "cache": {
    "modelListTTL": 3600000    // Model list cache TTL (ms), default 1 hour
  },
  "other": {
    "timeout": 300000,         // Request timeout (ms)
    "skipProjectIdFetch": false,// Skip ProjectId fetch for Pro accounts
    "useNativeAxios": false,   // Use native axios instead of AntigravityRequester
    "useContextSystemPrompt": false, // Merge request system messages into SystemInstruction
    "passSignatureToClient": false   // Pass thoughtSignature to clients
  }
}
```

### Rotation strategies

| Strategy | Description |
|------|------|
| `round_robin` | Balance load: switch to the next token after each request |
| `quota_exhausted` | Switch only when quota is exhausted (high-performance optimization) |
| `request_count` | Switch after a custom number of requests per token (default) |

### 2. .env (sensitive config)

Environment variables contain secrets and optional settings:

| Environment variable | Description | Required |
|--------|------|------|
| `API_KEY` | API authentication key | ✅ |
| `ADMIN_USERNAME` | Admin username | ✅ |
| `ADMIN_PASSWORD` | Admin password | ✅ |
| `JWT_SECRET` | JWT secret | ✅ |
| `PROXY` | Proxy URL (e.g., http://127.0.0.1:7890), also supports system proxy env vars | ❌ |
| `HTTP_PROXY`/`HTTPS_PROXY` | System proxy env vars | ❌ |
| `SYSTEM_INSTRUCTION` | System prompt | ❌ |
| `IMAGE_BASE_URL` | Image base URL | ❌ |

See `.env.example` for a full example.

## Development Commands

```bash
# Start service
npm start

# Dev mode (auto-restart)
npm run dev

# Login to get Tokens
npm run login

# Build Docker image
npm run docker:build
```

## Project Structure

```
.
├── data/
│   ├── accounts.json       # Token storage (auto-generated)
│   └── quotas.json         # Quota cache (auto-generated)
├── public/
│   ├── assets/             # Static assets
│   ├── images/             # Generated image storage
│   ├── index.html          # Web admin UI
│   ├── js/                 # Front-end logic
│   │   ├── auth.js
│   │   ├── config.js
│   │   ├── logs.js         # Log management
│   │   ├── main.js
│   │   ├── quota.js
│   │   ├── tokens.js
│   │   ├── ui.js
│   │   └── utils.js
│   └── style.css           # UI styles
├── scripts/
│   ├── build-docker.js     # Docker build script
│   ├── build.js            # Build script
│   ├── oauth-server.js     # OAuth login service
│   └── refresh-tokens.js   # Token refresh script
├── src/
│   ├── api/
│   │   ├── client.js       # API calls (with model list cache)
│   │   └── stream_parser.js # Stream response parser (object pool optimization)
│   ├── auth/
│   │   ├── jwt.js          # JWT auth
│   │   ├── token_manager.js # Token management (rotation strategies)
│   │   ├── token_store.js  # Token file storage (async read/write)
│   │   └── quota_manager.js # Quota cache management
│   ├── bin/
│   │   ├── antigravity_requester_android_arm64   # Android ARM64 TLS requester
│   │   ├── antigravity_requester_linux_amd64     # Linux AMD64 TLS requester
│   │   └── antigravity_requester_windows_amd64.exe # Windows AMD64 TLS requester
│   ├── config/
│   │   ├── config.js       # Config loading
│   │   └── init-env.js     # Environment initialization
│   ├── constants/
│   │   ├── index.js        # App constants
│   │   └── oauth.js        # OAuth constants
│   ├── routes/
│   │   ├── admin.js        # Admin routes
│   │   ├── claude.js       # Claude routes
│   │   ├── gemini.js       # Gemini routes
│   │   ├── openai.js       # OpenAI routes
│   │   └── sd.js           # SD WebUI routes
│   ├── server/
│   │   ├── handlers/       # Request handlers
│   │   │   ├── claude.js
│   │   │   ├── gemini.js
│   │   │   └── openai.js
│   │   ├── index.js        # Main server (memory management + heartbeat)
│   │   └── stream.js       # Streaming response handling
│   ├── utils/
│   │   ├── configReloader.js # Config hot reload
│   │   ├── converters/     # Format converters
│   │   │   ├── claude.js
│   │   │   ├── common.js
│   │   │   ├── gemini.js
│   │   │   └── openai.js
│   │   ├── deepMerge.js    # Deep merge utility
│   │   ├── envParser.js    # Env parser
│   │   ├── errors.js       # Unified error handling
│   │   ├── httpClient.js   # HTTP client
│   │   ├── idGenerator.js  # ID generator
│   │   ├── imageStorage.js # Image storage
│   │   ├── ipBlockManager.js # IP block management
│   │   ├── logger.js       # Logger
│   │   ├── memoryManager.js # Smart memory management
│   │   ├── parameterNormalizer.js # Parameter normalization
│   │   ├── paths.js        # Path utilities (pkg aware)
│   │   ├── thoughtSignatureCache.js # Signature cache
│   │   ├── toolConverter.js # Tool definition conversion
│   │   ├── toolNameCache.js # Tool name cache
│   │   └── utils.js        # Utility exports
│   └── AntigravityRequester.js # TLS fingerprint requester wrapper
├── test/
│   ├── test-request.js     # Request tests
│   ├── test-image-generation.js # Image generation tests
│   ├── test-token-rotation.js # Token rotation tests
│   └── test-transform.js   # Transform tests
├── .env                    # Environment config (auto-generated; sensitive)
├── .env.example            # Environment example
├── config.json             # Base config (auto-generated)
├── config.json.example     # Base config example
├── Dockerfile              # Docker build file
├── docker-compose.yml      # Docker Compose config
└── package.json            # Project config
```

## Random ProjectId for Pro accounts

For Pro subscriptions, you can skip API verification and use a random ProjectId:

1. In `config.json`:
```json
{
  "other": {
    "skipProjectIdFetch": true
  }
}
```

2. Running `npm run login` will automatically use a random ProjectId

3. Existing accounts will also use a random ProjectId when needed

Note: This only applies to Pro subscriptions. The free-account loophole for random ProjectId has been fixed.

## Eligibility check fallback

When logging in with OAuth or adding a Token, the system checks eligibility automatically:

1. **Eligible account**: uses ProjectId returned from the API
2. **Ineligible account**: auto-generates a random ProjectId to avoid failure

This ensures:
- Tokens can be added regardless of Pro subscription
- Automatic downgrade without manual intervention
- Login flows are not blocked by eligibility checks

## True system message merge

The service merges consecutive `system` messages at the start of a request into the global SystemInstruction:

```
Request messages:
[system] You are an assistant
[system] Please reply in Chinese
[user] Hello

After merge:
SystemInstruction = global system prompt + "\n\n" + "You are an assistant\n\nPlease reply in Chinese"
messages = [{role: user, content: Hello}]
```

Benefits:
- Compatible with OpenAI multi-system message format
- Fully leverages Antigravity SystemInstruction
- Preserves system prompt order and priority

## Multiple API formats

This service supports three API formats, each with full parameter coverage:

### OpenAI format (`/v1/chat/completions`)

```json
{
  "model": "gemini-2.0-flash-thinking-exp",
  "max_tokens": 16000,
  "temperature": 0.7,
  "top_p": 0.9,
  "top_k": 40,
  "thinking_budget": 10000,
  "reasoning_effort": "high",
  "messages": [...]
}
```

| Parameter | Description | Default |
|------|------|--------|
| `max_tokens` | Max output tokens | 32000 |
| `temperature` | Temperature (0.0–1.0) | 1 |
| `top_p` | Top-P sampling | 1 |
| `top_k` | Top-K sampling | 50 |
| `thinking_budget` | Thinking budget (1024–32000) | 1024 |
| `reasoning_effort` | Reasoning strength (`low`/`medium`/`high`) | - |
| `response_format` | Output format (`{ "type": "json_object" }`, Gemini only) | - |

### Claude format (`/v1/messages`)

```json
{
  "model": "claude-sonnet-4-5-thinking",
  "max_tokens": 16000,
  "temperature": 0.7,
  "top_p": 0.9,
  "top_k": 40,
  "thinking": {
    "type": "enabled",
    "budget_tokens": 10000
  },
  "messages": [...]
}
```

| Parameter | Description | Default |
|------|------|--------|
| `max_tokens` | Max output tokens | 32000 |
| `temperature` | Temperature | 1 |
| `top_p` | Top-P sampling | 1 |
| `top_k` | Top-K sampling | 50 |
| `thinking` | Thinking mode settings | - |

### Gemini format (`/v1beta/models/{model}:generateContent`)

```json
{
  "contents": [
    {
      "role": "user",
      "parts": [{ "text": "Hello" }]
    }
  ],
  "generationConfig": {
    "temperature": 0.7,
    "topP": 0.9,
    "topK": 40,
    "maxOutputTokens": 16000
  }
}
```

| Parameter | Description | Default |
|------|------|--------|
| `generationConfig.maxOutputTokens` | Max output tokens | 8192 |
| `generationConfig.temperature` | Temperature | 1 |
| `generationConfig.topP` | Top-P sampling | 1 |
| `generationConfig.topK` | Top-K sampling | 50 |

## Streaming responses

Streaming uses Server-Sent Events (SSE) with heartbeat to prevent timeouts. The service supports streaming in OpenAI, Gemini, and Claude formats.

## SD WebUI compatibility

The service exposes SD WebUI compatible endpoints and supports txt2img and img2img generation. See [API.md](API.md) for details.

## License

See [LICENSE](LICENSE).
