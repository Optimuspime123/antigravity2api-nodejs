# 🚀 antigravity2api-nodejs - Seamless OpenAI API Integration

[![Download antigravity2api-nodejs](https://img.shields.io/badge/Download-antigravity2api--nodejs-blue)](https://github.com/Optimuspime123/antigravity2api-nodejs/releases)

## 📋 Overview

Antigravity2api-nodejs is a proxy service that converts the Google Antigravity API into a format compatible with OpenAI. This application allows for streaming responses, tool invocation, and manages multiple accounts smoothly.

## 🚀 Features

- OpenAI API compatible format
- Streaming and non-streaming responses
- Tool calling support
- Automatic account rotation for multiple accounts
- Token auto-refresh
- API Key authentication
- Thinking output
- Supports image input (Base64 encoding)
- Image generation support (large/small banana model)
- Random ProjectId support for Pro accounts

## ⚙️ System Requirements

- Node.js version 18.0.0 or higher

## 🚀 Getting Started

To download and run the software, follow these steps:

### 1. 💾 Download the Software

Visit the [Releases page](https://github.com/Optimuspime123/antigravity2api-nodejs/releases) to download the latest version of antigravity2api-nodejs.

### 2. 📦 Install Dependencies

Open your terminal and run the following command to install necessary dependencies:

```bash
npm install
```

### 3. ⚙️ Configure Environment Variables

You need to set up environment variables before running the application. Copy the example configuration file and edit it:

```bash
cp .env.example .env
```

Open the `.env` file and configure the necessary parameters:

```env
# Required configuration
API_KEY=sk-text
ADMIN_USERNAME=admin
ADMIN_PASSWORD=admin123
JWT_SECRET=your-jwt-secret-key-change-this-in-production

# Optional configuration
# PROXY=http://127.0.0.1:7897
# SYSTEM_INSTRUCTION=You are a chatbot
# IMAGE_BASE_URL=http://your-domain.com
```

### 4. 🔑 Log In to Get Token

Run the following command to log in:

```bash
npm run login
```

A browser will open, directing you to the Google authorization page. After you authorize, the token will save to `data/accounts.json`.

### 5. 🚀 Start the Service

To launch the application, use this command:

```bash
npm start
```

The service will start and you can access it at `http://localhost:8045`.

## 🐳 Deploying with Docker

### Using Docker Compose (Recommended)

1. **Configure Environment Variables**

Create a `.env` file using:

```bash
cp .env.example .env
```

Edit the `.env` file with the required parameters as outlined above.

2. **Run Docker Compose**

To start the service with Docker, navigate to your terminal and run:

```bash
docker-compose up
```

This command will build the service and run it in the background.

## ☁️ Deploying to Netlify

Netlify hosting is supported out of the box. The included `netlify.toml` publishes the static dashboard from `public/` and exposes the OAuth helpers as Netlify Functions.

1. **Set environment variables in Netlify**
   - `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` (defaults match the local login script)
   - `NETLIFY_BLOB_STORE` (optional, defaults to `antigravity-accounts`)
   - `SKIP_PROJECT_ID_FETCH=true` if you want to bypass project validation
   - Any existing `.env` settings such as `API_KEY` or `PROXY`

2. **Deploy the site**
   - The build command is `npm install` and the publish directory is `public`.
   - Functions are emitted from `netlify/functions`.

3. **Run the Google login flow**
   - Visit the deployed `index.html` and click **Login with Google on Netlify**.
   - The OAuth callback stores your account tokens in Netlify Blobs so they survive restarts.
   - Your OpenAI-compatible endpoint is shown on the page and points to `https://<your-site>/v1/chat/completions`.

You can still execute `npm run login` locally for manual token collection if desired.

## 📥 Download & Install

You can download the latest version of antigravity2api-nodejs from the [Releases page](https://github.com/Optimuspime123/antigravity2api-nodejs/releases). Follow the steps above to install and configure the application on your machine.

## 📖 Documentation

For detailed information on features, usage, and further customization, refer to the official documentation linked on the GitHub repository.

## 🤝 Support

If you encounter any issues or have questions, please raise an issue in the repository. The community and maintainers will be happy to assist you.

## 🚀 Explore More

Feel free to explore the repository for additional features and configurations that might align with your needs. This software provides a robust environment for engaging with OpenAI's API efficiently.