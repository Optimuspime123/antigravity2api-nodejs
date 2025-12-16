# API Usage Guide

This document explains how to use the OpenAI-compatible API provided by Antigravity2API.

## Basic Configuration

All API requests require an API Key in the header:

```
Authorization: Bearer YOUR_API_KEY
```

Default service address: `http://localhost:8045`

## List Models

```bash
curl http://localhost:8045/v1/models \
  -H "Authorization: Bearer sk-text"
```

## Chat Completions

### Streaming Response

```bash
curl http://localhost:8045/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer sk-text" \
  -d '{
    "model": "gemini-2.0-flash-exp",
    "messages": [{"role": "user", "content": "Hello"}],
    "stream": true
  }'
```

### Non-Streaming Response

```bash
curl http://localhost:8045/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer sk-text" \
  -d '{
    "model": "gemini-2.0-flash-exp",
    "messages": [{"role": "user", "content": "Hello"}],
    "stream": false
  }'
```

## Tool Calling (Function Calling)

```bash
curl http://localhost:8045/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer sk-text" \
  -d '{
    "model": "gemini-2.0-flash-exp",
    "messages": [{"role": "user", "content": "What is the weather like in Beijing?"}],
    "tools": [{
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
    }]
  }'
```

## Image Input (Multimodal)

Supports Base64-encoded image input and is compatible with OpenAI's multimodal format:

```bash
curl http://localhost:8045/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer sk-text" \
  -d '{
    "model": "gemini-2.0-flash-exp",
    "messages": [{
      "role": "user",
      "content": [
        {"type": "text", "text": "What is in this image?"},
        {
          "type": "image_url",
          "image_url": {
            "url": "data:image/jpeg;base64,/9j/4AAQSkZJRg..."
          }
        }
      ]
    }],
    "stream": true
  }'
```

### Supported Image Formats

- JPEG/JPG (`data:image/jpeg;base64,...`)
- PNG (`data:image/png;base64,...`)
- GIF (`data:image/gif;base64,...`)
- WebP (`data:image/webp;base64,...`)

## Image Generation

Supports image generation with the big/small banana models. Generated images are returned in Markdown format:

```bash
curl http://localhost:8045/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer sk-text" \
  -d '{
    "model": "gemimi-3.0-pro-image",
    "messages": [{"role": "user", "content": "Draw a cute cat"}],
    "stream": false
  }'
```

## Request Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `model` | string | ✅ | Model name |
| `messages` | array | ✅ | Conversation message list |
| `stream` | boolean | ❌ | Enable streaming response, default false |
| `temperature` | number | ❌ | Temperature, default 1 |
| `top_p` | number | ❌ | Top P, default 0.85 |
| `top_k` | number | ❌ | Top K, default 50 |
| `max_tokens` | number | ❌ | Maximum tokens, default 8096 |
| `tools` | array | ❌ | Tool list (Function Calling) |

## Response Format

### Non-Streaming Response

```json
{
  "id": "chatcmpl-xxx",
  "object": "chat.completion",
  "created": 1234567890,
  "model": "gemini-2.0-flash-exp",
  "choices": [{
    "index": 0,
    "message": {
      "role": "assistant",
      "content": "Hello! How can I help you?"
    },
    "finish_reason": "stop"
  }],
  "usage": {
    "prompt_tokens": 10,
    "completion_tokens": 20,
    "total_tokens": 30
  }
}
```

### Streaming Response

```
data: {"id":"chatcmpl-xxx","object":"chat.completion.chunk","created":1234567890,"model":"gemini-2.0-flash-exp","choices":[{"index":0,"delta":{"role":"assistant","content":"Hel"},"finish_reason":null}]}

data: {"id":"chatcmpl-xxx","object":"chat.completion.chunk","created":1234567890,"model":"gemini-2.0-flash-exp","choices":[{"index":0,"delta":{"content":"lo"},"finish_reason":null}]}

data: [DONE]
```

## Error Handling

The API returns standard HTTP status codes:

| Status Code | Description |
|-------------|-------------|
| 200 | Request succeeded |
| 400 | Bad request |
| 401 | Invalid API Key |
| 429 | Too many requests |
| 500 | Internal server error |

Error response format:

```json
{
  "error": {
    "message": "Error message",
    "type": "invalid_request_error",
    "code": "invalid_api_key"
  }
}
```

## Usage Examples

### Python

```python
import openai

openai.api_base = "http://localhost:8045/v1"
openai.api_key = "sk-text"

response = openai.ChatCompletion.create(
    model="gemini-2.0-flash-exp",
    messages=[{"role": "user", "content": "Hello"}],
    stream=True
)

for chunk in response:
    print(chunk.choices[0].delta.get("content", ""), end="")
```

### Node.js

```javascript
import OpenAI from 'openai';

const openai = new OpenAI({
  baseURL: 'http://localhost:8045/v1',
  apiKey: 'sk-text'
});

const stream = await openai.chat.completions.create({
  model: 'gemini-2.0-flash-exp',
  messages: [{ role: 'user', content: 'Hello' }],
  stream: true
});

for await (const chunk of stream) {
  process.stdout.write(chunk.choices[0]?.delta?.content || '');
}
```

## Notes

1. All requests must include a valid API Key.
2. Image input must use Base64 encoding.
3. Streaming responses use the Server-Sent Events (SSE) format.
4. Tool calling requires models that support Function Calling.
5. Image generation is supported only by specific models (big/small banana).
