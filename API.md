# API Usage Guide

This document explains how to use the Antigravity2API OpenAI-compatible API.

## Basic configuration

All API requests must include the API key in the header:

```
Authorization: Bearer YOUR_API_KEY
```

Default service address: `http://localhost:8045`

## List models

```bash
curl http://localhost:8045/v1/models \
  -H "Authorization: Bearer sk-text"
```

## Chat completions

### Streaming response

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

### Non-streaming response

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

## Function calling

```bash
curl http://localhost:8045/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer sk-text" \
  -d '{
    "model": "gemini-2.0-flash-exp",
    "messages": [{"role": "user", "content": "How is the weather in Beijing?"}],
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

## Image input (multimodal)

Base64-encoded image input is supported using the OpenAI multimodal format:

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

### Supported image formats

- JPEG/JPG (`data:image/jpeg;base64,...`)
- PNG (`data:image/png;base64,...`)
- GIF (`data:image/gif;base64,...`)
- WebP (`data:image/webp;base64,...`)

## Image generation

Use the banana models to generate images. Results are returned in Markdown format:

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

## Request parameters

| Parameter | Type | Required | Description |
|------|------|------|------|
| `model` | string | ✅ | Model name |
| `messages` | array | ✅ | List of conversation messages |
| `stream` | boolean | ❌ | Whether to stream the response (default: false) |
| `temperature` | number | ❌ | Temperature parameter (default: 1) |
| `top_p` | number | ❌ | Top P parameter (default: 0.85) |
| `top_k` | number | ❌ | Top K parameter (default: 50) |
| `max_tokens` | number | ❌ | Maximum token count (default: 8096) |
| `tools` | array | ❌ | Function calling tool definitions |

## Response format

### Non-streaming response

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

### Streaming response

```
data: {"id":"chatcmpl-xxx","object":"chat.completion.chunk","created":1234567890,"model":"gemini-2.0-flash-exp","choices":[{"index":0,"delta":{"role":"assistant","content":"Hel"},"finish_reason":null}]}

data: {"id":"chatcmpl-xxx","object":"chat.completion.chunk","created":1234567890,"model":"gemini-2.0-flash-exp","choices":[{"index":0,"delta":{"content":"lo"},"finish_reason":null}]}

data: [DONE]
```

## Error handling

The API returns standard HTTP status codes:

| Status | Description |
|--------|------|
| 200 | Request succeeded |
| 400 | Invalid request parameters |
| 401 | API key is invalid |
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

## Usage examples

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

1. All requests must include a valid API key.
2. Image input must use Base64 encoding.
3. Streaming responses use Server-Sent Events (SSE).
4. Function calling requires model support for that capability.
5. Image generation is only supported for the designated banana models.
