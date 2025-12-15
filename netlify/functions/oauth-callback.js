import axios from 'axios'
import { getStore } from '@netlify/blobs'
import crypto from 'crypto'

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '1071006060591-tmhssin2h21lcre235vtolojh4g403ep.apps.googleusercontent.com'
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || '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'
const BLOB_STORE_NAME = process.env.NETLIFY_BLOB_STORE || 'antigravity-accounts'
const SKIP_PROJECT_ID_FETCH = process.env.SKIP_PROJECT_ID_FETCH === 'true'

const store = getStore({ name: BLOB_STORE_NAME })

const parseCookies = (cookieHeader = '') => Object.fromEntries(
    cookieHeader.split(';').map(c => c.trim()).filter(Boolean).map(c => {
        const [key, ...rest] = c.split('=')
        return [key, rest.join('=')]
    })
)

const buildOrigin = (event) => {
    const proto = event.headers['x-forwarded-proto'] || 'https'
    const host = event.headers.host
    return `${proto}://${host}`
}

const getRedirectUri = (event) => `${buildOrigin(event)}/.netlify/functions/oauth-callback`

const getAxiosConfig = () => {
    const axiosConfig = { timeout: 180000 }
    if (process.env.PROXY) {
        const proxyUrl = new URL(process.env.PROXY)
        axiosConfig.proxy = {
            protocol: proxyUrl.protocol.replace(':', ''),
            host: proxyUrl.hostname,
            port: parseInt(proxyUrl.port)
        }
    }
    return axiosConfig
}

const exchangeCodeForToken = async (code, redirectUri) => {
    const postData = new URLSearchParams({
        code,
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code'
    })

    const response = await axios({
        method: 'POST',
        url: 'https://oauth2.googleapis.com/token',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        data: postData.toString(),
        ...getAxiosConfig()
    })

    return response.data
}

const fetchUserEmail = async (accessToken) => {
    const response = await axios({
        method: 'GET',
        url: 'https://www.googleapis.com/oauth2/v2/userinfo',
        headers: {
            'Host': 'www.googleapis.com',
            'User-Agent': 'Go-http-client/1.1',
            'Authorization': `Bearer ${accessToken}`,
            'Accept-Encoding': 'gzip'
        },
        ...getAxiosConfig()
    })
    return response.data?.email
}

const fetchProjectId = async (accessToken) => {
    const response = await axios({
        method: 'POST',
        url: 'https://daily-cloudcode-pa.sandbox.googleapis.com/v1internal:loadCodeAssist',
        headers: {
            'Host': 'daily-cloudcode-pa.sandbox.googleapis.com',
            'User-Agent': 'antigravity/1.11.9 windows/amd64',
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
            'Accept-Encoding': 'gzip'
        },
        data: JSON.stringify({ metadata: { ideType: 'ANTIGRAVITY' } }),
        ...getAxiosConfig()
    })
    return response.data?.cloudaicompanionProject
}

const buildHtml = (title, body) => `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${title}</title>
  <style>
    body { font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #0b1021; color: #e5e7eb; margin: 0; padding: 32px; }
    .card { max-width: 720px; margin: 0 auto; background: #111827; border: 1px solid #1f2937; border-radius: 16px; padding: 24px; box-shadow: 0 12px 40px rgba(0,0,0,0.4); }
    h1 { margin-top: 0; color: #f9fafb; }
    .pill { display: inline-flex; align-items: center; gap: 8px; background: #10b9811a; color: #34d399; padding: 6px 12px; border-radius: 999px; font-weight: 600; margin-bottom: 16px; }
    code { background: #0f172a; padding: 6px 10px; border-radius: 8px; color: #e5e7eb; display: inline-block; margin-top: 8px; }
    a { color: #93c5fd; }
    .actions { margin-top: 20px; display: flex; gap: 12px; flex-wrap: wrap; }
    .btn { padding: 10px 14px; background: linear-gradient(135deg,#2563eb,#22d3ee); color: #0b1021; border-radius: 10px; text-decoration: none; font-weight: 700; }
  </style>
</head>
<body><div class="card">${body}</div></body></html>`

const buildError = (message) => ({
    statusCode: 400,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
    body: buildHtml('Login failed', `<h1>Authorization failed</h1><p>${message}</p>`)
})

export async function handler(event) {
    const params = event.queryStringParameters || {}
    const cookies = parseCookies(event.headers.cookie)
    const state = params.state
    const origin = buildOrigin(event)
    const redirectUri = getRedirectUri(event)

    if (!state || cookies.oauth_state !== state) {
        return buildError('State validation failed. Please start the login again.')
    }

    if (!params.code) {
        return buildError('No authorization code found in callback.')
    }

    try {
        const tokenData = await exchangeCodeForToken(params.code, redirectUri)
        const account = {
            access_token: tokenData.access_token,
            refresh_token: tokenData.refresh_token,
            expires_in: tokenData.expires_in,
            timestamp: Date.now(),
            enable: true
        }

        try {
            const email = await fetchUserEmail(account.access_token)
            if (email) account.email = email
        } catch (error) {
            // Optional, do not block on email fetch
        }

        if (!SKIP_PROJECT_ID_FETCH) {
            const projectId = await fetchProjectId(account.access_token)
            if (!projectId) {
                return buildError('Account is not eligible (projectId missing).')
            }
            account.projectId = projectId
        } else {
            account.projectId = crypto.randomUUID()
        }

        const accounts = (await store.getJSON('accounts')) || []
        accounts.push(account)
        await store.setJSON('accounts', accounts)

        const openAiUrl = `${origin}/v1/chat/completions`
        const body = `
      <div class="pill">✅ Token saved to Netlify storage</div>
      <h1>Authorization successful</h1>
      <p>Your Google account token has been saved. You can now use the deployed API via the OpenAI-compatible endpoint:</p>
      <code>${openAiUrl}</code>
      <div class="actions">
        <a class="btn" href="/">Back to dashboard</a>
        <a class="btn" href="${origin}/.netlify/functions/oauth-start">Add another account</a>
      </div>
    `

        return {
            statusCode: 200,
            headers: { 'Content-Type': 'text/html; charset=utf-8' },
            body: buildHtml('Authorization successful', body)
        }
    } catch (error) {
        const message = error.response?.data?.error_description || error.message
        return buildError(message || 'Unexpected error during authorization.')
    }
}
