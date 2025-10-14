# Instructions to Add Debug Panel

To help debug the offline assignment issue, add the OfflineDebugPanel to your AssignmentsPage:

## Step 1: Import the Debug Panel

Add this import at the top of AssignmentsPage.tsx:

```typescript
import OfflineDebugPanel from './OfflineDebugPanel';
```

## Step 2: Add the Panel to Your Render

Add this right after the ScrollView opening tag in your AssignmentsPage render method:

```typescript
<ScrollView style={styles.container}>
  {/* Add debug panel for testing */}
  <OfflineDebugPanel />
  
  {/* Your existing content */}
  {loading ? (
    <View style={styles.loadingContainer}>
      <ActivityIndicator size="large" color={isDarkMode ? '#ffffff' : '#0000ff'} />
      <Text style={[styles.loadingText, isDarkMode && styles.darkText]}>Loading...</Text>
    </View>
  ) : (
    // ... rest of your existing content
```

## Step 3: Test Offline Assignment Creation

1. **Start with online mode** - Create a few products and players first
2. **Use "Force Offline" button** - This will simulate offline mode
3. **Check "Check Local Data"** - Verify products and players are cached locally
4. **Use "Test Offline Assignment"** - This will test assignment creation using the first available product/player
5. **Check the logs** - Look for detailed error messages if it fails

## Step 4: Compare with Manual Creation

After the automated test, try creating assignments manually through the regular UI while in forced offline mode.

## Expected Behavior

**Working offline assignment should:**
- Update local cache immediately
- Reduce product stock locally
- Increase player balance locally  
- Add 1 item to sync queue
- Show success message
- Sync to server when back online

**If it's not working, you'll see:**
- Error messages in console with specific details
- Which step is failing (product lookup, player lookup, stock check, etc.)
- Network state information
- Local data availability

This will help pinpoint exactly where the offline assignment creation is failing!