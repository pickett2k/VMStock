# MCP Tools Reference for VMStock

**Last Updated**: October 15, 2025  
**Project**: VMStock (vmstock-6fa52)  
**Authenticated User**: clemwill63@gmail.com  

---

## 🔥 Firebase MCP Server Integration

### Setup & Authentication Status
- ✅ **Firebase MCP Server**: Active and connected
- ✅ **Project ID**: `vmstock-6fa52`  
- ✅ **Project Name**: VMStock
- ✅ **Current Directory**: `C:\Users\scoob\Documents\Test Coding\Stock App\VMStock\VMStock`
- ✅ **Firebase.json**: Initialized with Firestore
- ✅ **Authentication**: Signed in as clemwill63@gmail.com

### Quick Setup Commands (if needed)
```bash
# Login to Firebase (already done)
npx firebase-tools login

# Set project directory (already configured)
firebase_update_environment --project_dir "C:\Users\scoob\Documents\Test Coding\Stock App\VMStock\VMStock"

# Set active project (already configured)  
firebase_update_environment --active_project "vmstock-6fa52"
```

---

## 🛠️ Available MCP Tools

### 1. Firebase Environment Management
```typescript
// Get current Firebase environment status
mcp_firebase_firebase_get_environment()

// Update project settings
mcp_firebase_firebase_update_environment({
  project_dir: "path/to/project",
  active_project: "project-id",
  active_user_account: "email@example.com"
})

// List all Firebase projects
mcp_firebase_firebase_list_projects()

// Get current project details
mcp_firebase_firebase_get_project()
```

### 2. Firebase App Management
```typescript
// List Firebase apps in project
mcp_firebase_firebase_list_apps()

// Get SDK configuration for app
mcp_firebase_firebase_get_sdk_config({
  platform: "web" | "ios" | "android",
  app_id: "specific-app-id"
})

// Create new Firebase app
mcp_firebase_firebase_create_app({
  platform: "web" | "ios" | "android",
  display_name: "App Name"
})
```

### 3. Firestore Database Operations
```typescript
// List all collections in database
mcp_firebase_firestore_list_collections()

// Get specific documents
mcp_firebase_firestore_get_documents({
  paths: ["organizations/vale-madrid-tuck-shop"]
})

// Query collections with filters
mcp_firebase_firestore_query_collection({
  collection_path: "organizations",
  filters: [
    {
      field: "name",
      op: "EQUAL",
      compare_value: { string_value: "Vale Madrid Tuck Shop" }
    }
  ],
  limit: 10
})

// Delete documents
mcp_firebase_firestore_delete_document({
  path: "collection/document-id"
})
```

### 4. Firebase Authentication
```typescript
// Get Firebase Auth users
mcp_firebase_auth_get_users({
  emails: ["user@example.com"],
  uids: ["firebase-uid"],
  limit: 100
})

// Update user account
mcp_firebase_auth_update_user({
  uid: "firebase-uid",
  disabled: false,
  claim: {
    key: "admin",
    value: true
  }
})

// Set SMS region policy
mcp_firebase_auth_set_sms_region_policy({
  policy_type: "ALLOW" | "DENY",
  country_codes: ["US", "GB"]
})
```

### 5. Firebase Security Rules
```typescript
// Get current security rules
mcp_firebase_firebase_get_security_rules({
  type: "firestore" | "rtdb" | "storage"
})

// Validate security rules
mcp_firebase_firebase_validate_security_rules({
  type: "firestore",
  source: "rules content"
})
```

### 6. Firebase Storage
```typescript
// Get download URL for file
mcp_firebase_storage_get_object_download_url({
  object_path: "path/to/file.jpg",
  bucket: "optional-bucket-name"
})
```

### 7. Firebase Messaging
```typescript
// Send push notification
mcp_firebase_messaging_send_message({
  registration_token: "device-token",
  title: "Notification Title",
  body: "Notification message"
})
```

### 8. Firebase Realtime Database
```typescript
// Get data from RTDB
mcp_firebase_realtimedatabase_get_data({
  path: "/users/user123"
})

// Set data in RTDB
mcp_firebase_realtimedatabase_set_data({
  path: "/users/user123",
  data: JSON.stringify({ name: "John Doe" })
})
```

### 9. Firebase Remote Config
```typescript
// Get Remote Config template
mcp_firebase_remoteconfig_get_template({
  version_number: "optional-version"
})

// Update Remote Config
mcp_firebase_remoteconfig_update_template({
  template: configObject
})
```

### 10. Firebase Functions
```typescript
// Get Cloud Functions logs
mcp_firebase_functions_get_logs({
  function_names: ["functionName"],
  min_severity: "INFO",
  page_size: 50
})
```

---

## 📊 VMStock-Specific Usage Examples

### Analyzing Current Data Structure
```typescript
// Get all organizations
const orgs = await mcp_firebase_firestore_query_collection({
  collection_path: "organizations",
  filters: [],
  limit: 10
});

// Get Vale Madrid organization details
const valeMadrid = await mcp_firebase_firestore_get_documents({
  paths: ["organizations/vale-madrid-tuck-shop"]
});

// Check current users in organization
const users = await mcp_firebase_auth_get_users({
  limit: 100
});
```

### Security Rules Analysis
```typescript
// Review current Firestore rules
const rules = await mcp_firebase_firebase_get_security_rules({
  type: "firestore"
});

// Validate new rules
const validation = await mcp_firebase_firebase_validate_security_rules({
  type: "firestore",
  source: `
    rules_version = '2';
    service cloud.firestore {
      match /databases/{database}/documents {
        // Your rules here
      }
    }
  `
});
```

### User Management
```typescript
// Get specific user details
const user = await mcp_firebase_auth_get_users({
  emails: ["admin@valemadrid.com"]
});

// Update user permissions
await mcp_firebase_auth_update_user({
  uid: "user-uid-here",
  claim: {
    key: "isAdmin",
    value: true
  }
});
```

### Data Migration & Cleanup
```typescript
// List all collections to understand structure
const collections = await mcp_firebase_firestore_list_collections();

// Query specific data for analysis
const products = await mcp_firebase_firestore_query_collection({
  collection_path: "organizations/vale-madrid-tuck-shop/products",
  filters: [],
  limit: 50
});
```

---

## 🔧 Troubleshooting Common Issues

### MCP Server Not Connected
```bash
# Re-authenticate if needed
npx firebase-tools login

# Verify project directory
firebase_get_environment

# Reset project if needed
firebase_update_environment --active_project "vmstock-6fa52"
```

### Permission Errors
- Ensure you're authenticated as the correct user
- Check that your Google account has access to the Firebase project
- Verify project ID is correct (`vmstock-6fa52`)

### Rate Limits
- Firebase MCP tools respect Firebase API rate limits
- Use pagination (`limit` parameter) for large queries
- Batch operations when possible

---

## 📋 Quick Reference Commands

### Most Common Operations for VMStock:
```typescript
// 1. Check environment
mcp_firebase_firebase_get_environment()

// 2. List Firestore collections  
mcp_firebase_firestore_list_collections()

// 3. Query organizations
mcp_firebase_firestore_query_collection({
  collection_path: "organizations",
  filters: [],
  limit: 5
})

// 4. Get users
mcp_firebase_auth_get_users({ limit: 20 })

// 5. Validate security rules
mcp_firebase_firebase_validate_security_rules({
  type: "firestore",
  source_file: "firestore.rules"
})
```

---

*This reference provides direct access to your Firebase backend through MCP tools, enabling real-time database analysis, user management, and debugging capabilities.*