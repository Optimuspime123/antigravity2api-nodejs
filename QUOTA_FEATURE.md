# Model quota management

## Feature description

A quota viewer has been added so the frontend management console can show the remaining quota and reset time for each token's models.

## Implementation approach

### Data storage
- **accounts.json**: Keep it lightweight and only store core authentication details.
- **data/quotas.json**: New file dedicated to quota data (lightweight persistence).
- **In-memory cache**: 5-minute cache to avoid frequent API requests.
- **Automatic cleanup**: Clear entries older than 1 hour every hour.

### Key files

1. **src/api/client.js**
   - Added `getModelsWithQuotas(token)`.
   - Extracts the `quotaInfo` field from the API response.
   - Returns a simplified quota data structure.

2. **src/auth/quota_manager.js** (new)
   - Quota cache management.
   - File persistence.
   - Convert UTC time to Beijing time.
   - Automatically clean expired data.

3. **src/routes/admin.js**
   - Added the `GET /admin/tokens/:refreshToken/quotas` endpoint.
   - Supports fetching quota info for a specific token on demand.

4. **public/app.js**
   - Added `toggleQuota()` to expand/collapse the quota panel.
   - Added `loadQuota()` to load quota data from the API.
   - Added `renderQuota()` to render progress bars and quota information.

5. **public/style.css**
   - Added styles for the quota display.
   - Progress bar styles support gradient colors: green (>50%), yellow (20–50%), red (<20%).

## Usage

### Frontend steps

1. Sign in to the management console.
2. Click the **"📊 View quota"** button on a token card.
3. The system automatically loads all model quotas for that token.
4. Data is shown as progress bars that include:
   - Model name
   - Remaining quota percentage (with color indicators)
   - Quota reset time (Beijing time)

### Data formats

#### API response example
```json
{
  "success": true,
  "data": {
    "lastUpdated": 1765109350660,
    "models": {
      "gemini-2.0-flash-exp": {
        "remaining": 0.972,
        "resetTime": "01-07 15:27",
        "resetTimeRaw": "2025-01-07T07:27:44Z"
      },
      "gemini-1.5-pro": {
        "remaining": 0.85,
        "resetTime": "01-07 16:15",
        "resetTimeRaw": "2025-01-07T08:15:30Z"
      }
    }
  }
}
```

#### quotas.json storage format
```json
{
  "meta": {
    "lastCleanup": 1765109350660,
    "ttl": 3600000
  },
  "quotas": {
    "1//0eDtvmkC_KgZv": {
      "lastUpdated": 1765109350660,
      "models": {
        "gemini-2.0-flash-exp": {
          "r": 0.972,
          "t": "2025-01-07T07:27:44Z"
        }
      }
    }
  }
}
```

## Features

✅ **On-demand loading**: Fetch quota info only when the user clicks.
✅ **Smart caching**: Reuse cached data within 5 minutes to reduce API calls.
✅ **Automatic cleanup**: Periodically clear expired data to keep the file light.
✅ **Visual display**: Progress bars clearly show remaining quota.
✅ **Color coding**: Green (>50%), yellow (20–50%), red (<20%).
✅ **Time conversion**: Automatically convert UTC timestamps to Beijing time.
✅ **Lightweight storage**: Use abbreviated fields and only store changed models.

## Notes

1. The first quota view triggers a Google API call and may take a few seconds.
2. Quota data is cached for 5 minutes. For fresh data, wait for the cache to expire before checking again.
3. The quotas.json file is created automatically—no manual setup required.
4. If a token is expired or invalid, an error message appears.

## Testing

After starting the service:
```bash
npm start
```

Open the management console and click any token's "View quota" button to test the feature.
