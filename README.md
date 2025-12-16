# 🚀 antigravity2api-nodejs - Seamless OpenAI API Integration

[![antigravity2api-nodejs](https://img.shields.io/badge/GitHub-Optimuspime123%2Fantigravity2api--nodejs-blue)](https://github.com/Optimuspime123/antigravity2api-nodejs)

## 📋 Overview

Antigravity2api-nodejs is a proxy service that converts the Google Antigravity API into a format compatible with OpenAI. This application allows for streaming responses, tool invocation, and manages multiple accounts smoothly. There are currently no packaged releases—clone the repository directly to get started.

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

To run the software, follow these steps:

### 1. 💾 Clone the Repository

```bash
git clone https://github.com/Optimuspime123/antigravity2api-nodejs.git
cd antigravity2api-nodejs
```

### 2. 📦 Install Dependencies

Install the required dependencies:

```bash
npm install
```

### 3. ⚙️ Configure Environment Variables

Set up environment variables before running the application:

```bash
cp .env.example .env
```

Edit the `.env` file and configure the necessary parameters:

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

### 4. 🔑 Log In to Get a Token

Run the following command to launch the login flow:

```bash
npm run login
```

A browser will open to the Google authorization page. After you authorize, the token will be saved to `data/accounts.json`.

### 5. 🚀 Start the Service

Start the application:

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

## 📥 Download & Install

There are currently no published releases. Clone the repository from `https://github.com/Optimuspime123/antigravity2api-nodejs` and follow the steps above to install and configure the application on your machine.

## 📖 Documentation

For detailed information on features, usage, and further customization, refer to the official documentation linked on the GitHub repository at [https://github.com/Optimuspime123/antigravity2api-nodejs](https://github.com/Optimuspime123/antigravity2api-nodejs).

## 🤝 Support

If you encounter any issues or have questions, please raise an issue in the repository. The community and maintainers will be happy to assist you.

## 🚀 Explore More

Feel free to explore the repository for additional features and configurations that might align with your needs. This software provides a robust environment for engaging with OpenAI's API efficiently.
