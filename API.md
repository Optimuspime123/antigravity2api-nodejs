# API Usage Guide

This document explains how to use the OpenAI-compatible API provided by Antigravity2API.

## Basic Configuration

All API requests must include your API Key in the header:

```
Authorization: Bearer YOUR_API_KEY
```

Default service address: `http://localhost:8045`

## Table of Contents

- [Get Model List](#get-model-list)
- [Chat Completions](#chat-completions)
- [Tool Calling](#tool-calling-function-calling)
- [Image Input](#image-input-multimodal)
- [Image Generation](#image-generation)
- [Thinking Models](#thinking-models)
- [SD WebUI Compatible API](#sd-webui-compatible-api)
- [Admin API](#admin-api)
- [Examples](#examples)

## Get Model List

```bash
curl http://localhost:8045/v1/models \
  -H "Authorization: Bearer YOUR_API_KEY"
```

**Note:** The model list is cached for 1 hour (configurable via `config.json` → `cache.modelListTTL`) to reduce API calls.

## Chat Completions

### Streaming response

```bash
curl http://localhost:8045/v1/chat/completions \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gemini-2.0-flash-exp",
    "messages": [{"role": "user", "content": "Hello"}],
    "stream": true
  }'
```

### Non-streaming response

```bash
curl http://localhost:8045/v1/chat/completions \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gemini-2.0-flash-exp",
    "messages": [{"role": "user", "content": "Hello"}],
    "stream": false
  }'
```

## Tool Calling (Function Calling)

```bash
curl http://localhost:8045/v1/chat/completions \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gemini-2.0-flash-exp",
    "messages": [{"role": "user", "content": "What is the weather in Beijing?"}],
    "tools": [
      {
        "type": "function",
        "function": {
          "name": "get_weather",
          "description": "Get weather information",
          "parameters": {
            "type": "object",
            "properties": {
              "location": {"type": "string", "description": "City name"}
            },
            "required": ["location"]
          }
        }
      }
    ]
  }'
```

## Image Input (Multimodal)

Base64-encoded image input is supported and compatible with OpenAI's multimodal format:

```json
{
  "model": "gemini-2.0-flash-exp",
  "messages": [
    {
      "role": "user",
      "content": [
        {"type": "text", "text": "What's in this image?"},
        {"type": "image_url", "image_url": {"url": "data:image/png;base64,..."}}
      ]
    }
  ]
}
```

### Supported image formats

- PNG
- JPG/JPEG
- WEBP
- GIF

## Image Generation

The `gemini-3-pro-image` model can generate images. The response includes a Markdown image link:

```bash
curl http://localhost:8045/v1/chat/completions \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gemini-3-pro-image",
    "messages": [{"role": "user", "content": "Draw a cute cat"}]
  }'
```

**Response example:**

```json
{
  "choices": [
    {
      "message": {
        "content": "![image](http://your-domain.com/images/xxx.png)"
      }
    }
  ]
}
```

**Notes:**
- Generated images are saved to `public/images/`
- Set `IMAGE_BASE_URL` so the correct image URL is returned

## Request Parameters

| Parameter | Type | Required | Description |
|------|------|------|------|
| `model` | string | ✅ | Model name |
| `messages` | array | ✅ | Conversation messages |
| `stream` | boolean | ❌ | Whether to stream (default: false) |
| `temperature` | number | ❌ | Temperature (default: 1) |
| `top_p` | number | ❌ | Top P (default: 1) |
| `top_k` | number | ❌ | Top K (default: 50) |
| `max_tokens` | number | ❌ | Max tokens (default: 32000) |
| `thinking_budget` | number | ❌ | Thinking budget (only for thinking models); 0 or 1024–32000 (default 1024; 0 disables) |
| `reasoning_effort` | string | ❌ | Reasoning strength (OpenAI format); `low`/`medium`/`high` |
| `tools` | array | ❌ | Tools list (Function Calling) |

## Response Format

### Non-streaming response

```json
{
  "id": "chatcmpl-xxx",
  "object": "chat.completion",
  "created": 1234567890,
  "model": "gemini-2.0-flash-exp",
  "choices": [
    {
      "index": 0,
      "message": {
        "role": "assistant",
        "content": "Hello! How can I help you?"
      },
      "finish_reason": "stop"
    }
  ]
}
```

### Streaming response

```text
data: {"id":"chatcmpl-xxx","object":"chat.completion.chunk","created":1234567890,"model":"gemini-2.0-flash-exp","choices":[{"index":0,"delta":{"role":"assistant","content":"H"},"finish_reason":null}]}

data: {"id":"chatcmpl-xxx","object":"chat.completion.chunk","created":1234567890,"model":"gemini-2.0-flash-exp","choices":[{"index":0,"delta":{"content":"i"},"finish_reason":null}]}
```

## Error Handling

The API returns standard HTTP status codes:

| Status | Description |
|------|------|
| 200 | Success |
| 400 | Invalid request parameters |
| 401 | Invalid API Key |
| 429 | Too many requests |
| 500 | Internal server error |

Error response format:

```json
{
  "error": {
    "message": "Error message",
    "type": "invalid_request_error",
    "code": "invalid_request"
  }
}
```

## Thinking Models

For models that support thinking (e.g., `gemini-2.5-pro`, `claude-opus-4-5-thinking`), you can control reasoning depth with the following parameters.

### Using reasoning_effort (OpenAI-compatible)

```json
{
  "model": "gemini-2.5-pro",
  "messages": [{"role": "user", "content": "Explain quantum entanglement"}],
  "reasoning_effort": "medium"
}
```

| reasoning_effort | thinking_budget | Description |
|------|------|------|
| `low` | 1024 | Fast response, good for simple questions (default) |
| `medium` | 16000 | Balanced mode |
| `high` | 32000 | Deep thinking for complex reasoning |

### Using thinking_budget (numeric)

```json
{
  "model": "gemini-2.5-pro",
  "messages": [{"role": "user", "content": "Prove the Pythagorean theorem"}],
  "thinking_budget": 16000
}
```

### 429 Auto-retry configuration

All 429 retry counts are controlled only by server-side settings:

- Global default retry count:
  - File: `config.json` → `other.retryTimes`
  - Example:

```json
{
  "other": {
    "retryTimes": 3
  }
}
```

The server always uses this value for 429 retries (default: 3).

### Thinking response format

Thinking output is returned in `reasoning_content` (compatible with DeepSeek format):

**Non-streaming:**

```json
{
  "choices": [
    {
      "message": {
        "reasoning_content": "Let me think...",
        "content": "Quantum entanglement is..."
      }
    }
  ]
}
```

**Streaming:**

```text
data: {"choices":[{"delta":{"reasoning_content":"Let me"}}]}

data: {"choices":[{"delta":{"reasoning_content":" think..."}}]}

data: {"choices":[{"delta":{"content":"Quantum entanglement is..."}}]}
```

### Models that support thinking

- `gemini-2.5-pro`
- `gemini-2.0-flash-thinking-exp`
- `claude-opus-4-5-thinking`
- `claude-sonnet-4-5-thinking`

## SD WebUI Compatible API

This service exposes Stable Diffusion WebUI-compatible endpoints for clients that support the SD WebUI API.

### Text-to-image

```
POST /sdapi/v1/txt2img
```

### Image-to-image

```
POST /sdapi/v1/img2img
```

### Other SD API endpoints

| Endpoint | Description |
|------|------|
| `GET /sdapi/v1/sd-models` | Get available image models |
| `GET /sdapi/v1/options` | Get current options |
| `GET /sdapi/v1/samplers` | Get available samplers |
| `GET /sdapi/v1/upscalers` | Get available upscalers |
| `GET /sdapi/v1/progress` | Get generation progress |

## Admin API

Admin API requires JWT authentication. Obtain a token via the login endpoint.

### Login

```
POST /admin/login
```

### Token Management

```
GET /admin/tokens
POST /admin/tokens
PUT /admin/tokens/:tokenId
DELETE /admin/tokens/:tokenId
```

### Model Quotas

```
GET /admin/tokens/:tokenId/quotas
POST /admin/quotas/refresh
```

### Rotation Strategy Config

```
GET /admin/rotation
PUT /admin/rotation
```

**Available strategies:**
- `round_robin`: switch tokens on every request
- `quota_exhausted`: switch only when quota is exhausted
- `request_count`: switch after a custom number of requests

### Configuration Management

```
GET /admin/config
PUT /admin/config
```

## Examples

```python
import requests

url = "http://localhost:8045/v1/chat/completions"
headers = {
    "Content-Type": "application/json",
    "Authorization": "Bearer sk-text",
}

data = {
    "model": "gemini-2.0-flash-exp",
    "messages": [{"role": "user", "content": "Hello"}],
}

resp = requests.post(url, headers=headers, json=data)
print(resp.json())
```

```javascript
fetch('http://localhost:8045/v1/chat/completions', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer sk-text'
  },
  body: JSON.stringify({
    model: 'gemini-2.0-flash-exp',
    messages: [{ role: 'user', content: 'Hello' }]
  })
}).then(res => res.json())
  .then(console.log)
```

## Configuration Options

Controls whether `thoughtSignature` is passed through to client responses.

Configure in `config.json`:

```json
{
  "other": {
    "passSignatureToClient": false
  }
}
```

- `false` (default): do not passthrough signatures
- `true`: passthrough signatures

**Response example when enabled:**

```json
{
  "choices": [
    {
      "message": {
        "reasoning_content": "Let me think...",
        "content": "...",
        "thoughtSignature": "..."
      }
    }
  ]
}
```

Controls whether `system` messages at the start of a request are merged into SystemInstruction.

- `false` (default): only uses global `SYSTEM_INSTRUCTION`
- `true`: merge initial consecutive `system` messages

## Notes

1. All `/v1/*` requests must include a valid API Key.
2. Admin API (`/admin/*`) requires JWT authentication.
3. Image input must be Base64 encoded.
4. Streaming responses use Server-Sent Events (SSE) with heartbeat to prevent timeouts.
5. Tool calling requires model support for Function Calling.
6. Image generation supports only `gemini-3-pro-image`.
7. Model lists are cached for 1 hour and configurable.
8. Thinking output is returned in `reasoning_content` (DeepSeek compatible).
9. Default rotation strategy is `request_count`, switching every 50 requests.
