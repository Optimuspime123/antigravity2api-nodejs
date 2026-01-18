# Front-End Modules Overview

The original `app.js` (1300+ lines) has been split into the following modules:

## Module Structure

```
├── utils.js    - Utility functions (font size, sensitive info masking)
├── ui.js       - UI components (Toast, Modal, Loading, Tab switching)
├── auth.js     - Authentication (login, logout, OAuth)
├── tokens.js   - Token management (CRUD, enable/disable, inline editing)
├── quota.js    - Quota management (view, refresh, cache, inline display)
├── config.js   - Configuration management (load, save, rotation strategy)
└── main.js     - Entry point (init, event bindings)
```

## Load Order

Modules are loaded in dependency order (in `index.html`):

1. **utils.js** - Base utilities
2. **ui.js** - UI components (depends on utils)
3. **auth.js** - Auth module (depends on ui)
4. **quota.js** - Quota module (depends on auth)
5. **tokens.js** - Token module (depends on auth, quota, ui)
6. **config.js** - Config module (depends on auth, ui)
7. **main.js** - Entry point (depends on all modules)

## Responsibilities

- Font size settings and persistence
- Sensitive info show/hide toggle
- localStorage management
- Toast notifications
- Confirm dialogs
- Loading overlays
- Tab navigation
- User login/logout
- OAuth authorization flow
- authFetch wrapper (auto 401 handling)
- Token auth state management
- Token list loading and rendering
- Token CRUD operations
- Inline field editing (projectId, email)
- Token detail modal
- Quota data cache (5-minute TTL)
- Inline quota summary display
- Quota detail expand/collapse
- Quota modal (multi-account switching)
- Force refresh quotas
- Config load (.env + config.json)
- Config save (separate sensitive/non-sensitive)
- Rotation strategy management
- Rotation status display
- Page initialization
- Login form event bindings
- Config form event bindings
- Auto-login detection

## Global Variables

Shared globals across modules:

- `authToken` - Auth token (auth.js)
- `cachedTokens` - Token list cache (tokens.js)
- `currentQuotaToken` - Current quota token (quota.js)
- `quotaCache` - Quota cache object (quota.js)
- `sensitiveInfoHidden` - Sensitive info visibility state (utils.js)

## Benefits

1. **Maintainability** - Each module has a single responsibility and is easy to locate and update
2. **Readability** - File sizes are reasonable (200–400 lines) with a clear structure
3. **Extensibility** - New features can be added by modifying the relevant module
4. **Testability** - Modules are isolated and easy to unit test
5. **Collaboration-friendly** - Reduces merge conflicts in multi-developer work

## Notes

1. Modules communicate through shared globals and functions.
2. Keep the load order to avoid dependency issues.
3. Be mindful of cross-module calls when making changes.
