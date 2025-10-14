# Organization Settings - Bugs & Issues

**Date**: October 13, 2025  
**Context**: Organization settings cache management issues discovered during architecture review

## 🔍 Issues Identified

### Issue 1: Cache Key Inconsistency
**Problem**: Mixed cache keys across components causing settings not to be properly cleared/restored
- `OrganizationContext.tsx` uses: `@organization_data`
- `HybridSyncService` references: `vmstock_organization` (legacy)
- **Impact**: Settings may not persist correctly across app restarts

### Issue 2: Organization Switching Data Contamination
**Problem**: `clearOrganization()` clears sync queues but **not collection data**
- Products, players, assignments from previous org leak into new org
- **Impact**: Cached data from different logins persists inappropriately
- **Root Cause**: Collection data (`products`, `players`, etc.) isn't cleared between org switches

### Issue 3: Offline Settings Persistence Gaps
**Problem**: `refreshOrganization()` only reads from AsyncStorage, misses provisional overlays
- Settings changes made offline may appear lost when going online
- **Impact**: User loses organization settings when switching online/offline states
- **Root Cause**: Not reading from HybridSyncService provisional overlay system

### Issue 4: Incomplete Cache Isolation
**Problem**: Cache isolation isn't fully consistent across all components
- Collection data isn't cleared between organization boundaries
- Cache initialization markers aren't properly cleaned up
- **Impact**: Stale data persists across organization boundaries

## 🛠️ Required Fixes

### Fix 1: Standardize Cache Keys
- Update all references to use `@organization_data` consistently
- Remove legacy `vmstock_organization` references from HybridSyncService

### Fix 2: Enhanced clearOrganization()
```typescript
// Add to OrganizationContext.clearOrganization()
const collections = ['products', 'players', 'assignments', 'staff-users', 'charges'];
for (const collection of collections) {
  await AsyncStorage.removeItem(collection);
  console.log(`🧹 Cleared ${collection} collection data`);
}
```

### Fix 3: Fix refreshOrganization()
```typescript
// Read from HybridSyncService with provisional overlay support
const freshOrgData = await hybridSyncService.getOrganizationWithOverlay(organization.id);
```

### Fix 4: Add Priority Sync for Organization Settings
- Organization settings should get priority in sync queue
- Extra retry attempts for critical settings
- Immediate sync attempt if online

## ✅ Implemented Fixes

### Fix 1: Standardize Cache Keys - COMPLETED ✅
- Cache keys are already standardized on `@organization_data` in OrganizationContext
- No legacy `vmstock_organization` references found in HybridSyncService

### Fix 2: Enhanced clearOrganization() - COMPLETED ✅
- Added collection data clearing to prevent cross-org contamination
- Added cache initialization marker cleanup
- Enhanced logging for better debugging

### Fix 3: Fixed refreshOrganization() - COMPLETED ✅
- Now reads from HybridSyncService provisional overlays first
- Fallback to AsyncStorage check if no overlay data
- Enhanced error handling with multiple fallback strategies

### Fix 4: Priority Sync for Organization Settings - COMPLETED ✅
- Added organization updates to high priority items in sync queue
- Organization settings now sync every 5 seconds when high priority sync is active
- Immediate sync attempt when online (already implemented)

## 📋 Testing Checklist
- [ ] Test organization switching with cached data from different orgs
- [ ] Test offline organization settings changes
- [ ] Test settings persistence across app restarts
- [ ] Test settings sync when going from offline to online
- [ ] Verify no cross-organization data contamination

## 🎯 Impact Assessment
**High Priority**: These issues directly affect the user experience when switching organizations or working offline, which are core VMStock features.