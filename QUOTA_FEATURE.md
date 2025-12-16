# Model Quota Management

## Feature Overview

A quota view has been added so the admin UI can display the remaining quota and reset time for every model associated with each token.

## Implementation

### Data Storage
- **accounts.json**: Keep it lean; only core authentication data is stored.
- **data/quotas.json**: New file dedicated to quota information (lightweight persistence).
- **In-memory cache**: 5-minute cache to avoid frequent API requests.
- **Automatic cleanup**: Remove records that have not been updated for over an hour, every hour.

### Key Files

1. **src/api/client.js**
   - Adds `getModelsWithQuotas(token)`
   - Extracts the `quotaInfo` field from the API response
   - Returns a simplified quota data structure

2. **src/auth/quota_manager.js** (new)
   - Quota cache management
   - File persistence
   - Convert UTC time to Beijing time
   - Automatic cleanup of expired records

3. **src/routes/admin.js**
   - Adds `GET /admin/tokens/:refreshToken/quotas` endpoint
   - Fetch quota information for a specific token on demand

4. **public/app.js**
   - Adds `toggleQuota()` to expand/collapse the quota panel
   - Adds `loadQuota()` to load quota data from the API
   - Adds `renderQuota()` to render progress bars and quota details

5. **public/style.css**
   - Adds styles for quota display
   - Progress bar styles (gradient colors: green >50%, yellow 20-50%, red <20%)

## How to Use

### Frontend Steps

1. Log in to the admin dashboard.
2. Click the **"📊 View Quota"** button on a token card.
3. The system loads quota information for every model tied to that token.
4. The UI displays:
   - Model name
   - Remaining quota percentage (with color indicator)
   - Quota reset time (Beijing time)

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

#### quotas.json Storage Format
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

✅ **On-demand loading**: Fetch quota data only when the user clicks.  
✅ **Smart caching**: Reuse cached data within 5 minutes to reduce API calls.  
✅ **Automatic cleanup**: Periodically remove stale data to keep the file small.  
✅ **Visual display**: Progress bars for remaining quota.  
✅ **Color cues**: Green (>50%), yellow (20-50%), red (<20%).  
✅ **Time conversion**: Automatically converts UTC time to Beijing time.  
✅ **Lightweight storage**: Uses abbreviated fields to store only changed models.  

## Notes

1. The first quota lookup calls the Google API and may take a few seconds.
2. Quota data is cached for 5 minutes; wait for the cache to expire to get the latest data.
3. The quotas.json file is created automatically—no manual setup needed.
4. If a token is expired or invalid, an error will be shown.

## Testing

After starting the service:
```bash
npm start
```

Open the admin UI and click any token's "View Quota" button to test.
