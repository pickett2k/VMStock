# VMStock Production Build Guide

## Prerequisites
- EAS CLI installed: `npm install -g eas-cli`
- Expo account configured: `eas login`

### For iOS TestFlight:
- Apple Developer Account (paid)
- App Store Connect app created
- iOS distribution certificates configured
- Update `eas.json` submit section with your Apple details:
  - `appleId`: Your Apple Developer account email
  - `ascAppId`: Your App Store Connect app ID 
  - `appleTeamId`: Your Apple Team ID

### For Android:
- No additional requirements for APK builds
- For Play Store: Google Play Console account

## Build Commands

### 1. TestFlight Build (iOS testing with test Stripe keys)
```bash
# iOS TestFlight build with test credentials - ready for TestFlight distribution
eas build --platform ios --profile testflight

# Then submit to TestFlight automatically
eas submit --platform ios --profile testflight
```

### 2. Test Production Build (with test Stripe keys)
```bash
# Android APK with NFC support using test credentials
eas build --platform android --profile production-test

# iOS build with test credentials (for local testing)
eas build --platform ios --profile production-test
```

### 3. Preview Build (for internal testing)
```bash
# Android preview build
eas build --platform android --profile preview

# iOS preview build  
eas build --platform ios --profile preview
```

### 4. Full Production Build (when ready to go live)
```bash
# Update eas.json with live Stripe keys first, then:
eas build --platform android --profile production
eas build --platform ios --profile production
```

## Build Profiles Explained

### `testflight` (iOS only)
- ✅ TestFlight distribution ready
- ✅ App Store Connect compatible
- ✅ NFC payments enabled  
- ✅ Uses Stripe TEST environment (safe for testing)
- 🧪 Perfect for beta testing with TestFlight users

### `production-test`
- ✅ Full production optimization and signing
- ✅ NFC payments enabled
- ✅ Uses Stripe TEST environment (safe for testing)
- ✅ Generates production-ready APK/IPA
- 🧪 Perfect for testing production flow with fake payments

### `preview`  
- ✅ Internal distribution
- ✅ NFC payments enabled
- ✅ Uses Stripe TEST environment
- 📱 Good for QA testing

### `production`
- ✅ App store/Play store ready
- ✅ Uses LIVE Stripe keys (when configured)
- 💰 Real payments only

## NFC Testing Checklist

Before building, ensure:
- [ ] Physical Android device with NFC capability
- [ ] NFC enabled in device settings
- [ ] Stripe Test Terminal location created
- [ ] Test payment methods configured

## Environment Variables

Current test setup uses:
```
STRIPE_ENABLED=true
STRIPE_PUBLISHABLE_KEY=pk_test_51SEvQ0... (test key)
STRIPE_TERMINAL_LOCATION_ID=tml_test_location
```

For production, update to:
```
STRIPE_ENABLED=true  
STRIPE_PUBLISHABLE_KEY=pk_live_... (live key)
STRIPE_TERMINAL_LOCATION_ID=tml_... (live location)
```

## Testing Flow

1. Build with `production-test` profile
2. Install APK on NFC-capable Android device
3. Test full payment flow with test cards
4. Verify NFC tap-to-pay functionality
5. Check payment confirmations work
6. When satisfied, build with `production` profile

## Next Steps for Going Live

1. Get live Stripe keys from Stripe Dashboard
2. Create live Terminal location in Stripe
3. Update `eas.json` production profile with live keys
4. Build with `production` profile
5. Submit to app stores