# Model Quota Management

## Overview

This feature adds model quota visibility so you can see the remaining quota and reset time for each Token in the admin UI.

## Implementation

### Data Storage
- **accounts.json**: kept minimal with only core authentication data
- **data/quotas.json**: new file dedicated to quota data (lightweight persistence)
- **In-memory cache**: 5-minute cache to reduce frequent API requests
- **Automatic cleanup**: removes data that has not been updated for over 1 hour

### Key Files

1. **src/api/client.js**
   - Added `getModelsWithQuotas(token)`
   - Extracts the `quotaInfo` field from API responses
   - Returns a simplified quota data structure

2. **src/auth/quota_manager.js** (new)
   - Quota cache management
   - File persistence
   - UTC to Beijing time conversion
   - Automatic cleanup of expired data

3. **src/routes/admin.js**
   - Added `GET /admin/tokens/:refreshToken/quotas`
   - Supports on-demand quota retrieval for a specific Token

4. **public/app.js**
   - Added `toggleQuota()` to expand/collapse the quota panel
   - Added `loadQuota()` to fetch quota data from the API
   - Added `renderQuota()` to render progress bars and quota data

5. **public/style.css**
   - Added styles for quota display
   - Progress bar colors (green > 50%, yellow 20–50%, red < 20%)

## Usage

### UI Steps

1. Log in to the admin UI
2. Click **"📊 View Quota"** on a Token card
3. The system loads the quota for all models under that Token
4. Quotas are shown as progress bars with:
   - Model name
   - Remaining quota percentage (color-coded)
   - Reset time (Beijing time)

### Data Formats

#### API Response Example
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

#### quotas.json Storage Example
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

## Highlights

✅ **On-demand loading**: only fetches quotas when the user clicks
✅ **Smart caching**: reuses cache within 5 minutes to reduce API calls
✅ **Automatic cleanup**: removes stale data periodically
✅ **Visual display**: progress bars clearly show remaining quota
✅ **Color indicators**: green (>50%), yellow (20–50%), red (<20%)
✅ **Time conversion**: automatically converts UTC to Beijing time
✅ **Lightweight storage**: uses shortened fields and stores only changed models

## Notes

1. The first quota fetch calls the Google API and may take a few seconds.
2. Quota data is cached for 5 minutes. Wait for the cache to expire to see fresh data.
3. The quotas.json file is created automatically; no manual setup is required.
4. If a Token is expired or invalid, an error message is shown.

## Testing

After starting the service:
```bash
npm start
```

Open the admin UI and click "View Quota" on any Token card to test the feature.
