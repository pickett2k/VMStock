# VMStock Firebase Migration Guide

## Quick Start Setup

### 1. Environment Configuration
1. Copy `.env.example` to `.env`
2. Fill in your Firebase project credentials
3. Add any Clerk credentials if using Clerk for auth

### 2. Firebase Project Setup
1. Go to [Firebase Console](https://console.firebase.google.com/)
2. Create a new project or use existing
3. Enable the following services:
   - Authentication (Email/Password + Phone)
   - Firestore Database
   - Analytics
   - Crashlytics

### 3. Get Configuration Keys
**Firebase Console → Project Settings → General:**
- Copy Web app config values to `.env`
- Download `google-services.json` for Android
- Download `GoogleService-Info.plist` for iOS

### 4. Install Dependencies
```bash
npm install @react-native-firebase/app @react-native-firebase/auth @react-native-firebase/firestore @react-native-firebase/analytics @react-native-firebase/crashlytics react-native-uuid react-native-network-info
```

### 5. Platform Configuration

**iOS (ios/Podfile):**
```ruby
# Add Firebase pods
pod 'Firebase', :modular_headers => true
pod 'FirebaseCoreInternal', :modular_headers => true
pod 'GoogleUtilities', :modular_headers => true
```

**Android (android/app/build.gradle):**
```gradle
apply plugin: 'com.google.gms.google-services'
```

**Android (android/build.gradle):**
```gradle
dependencies {
    classpath 'com.google.gms:google-services:4.4.0'
}
```

### 6. Current Progress Tracking
Use `FIREBASE_IMPLEMENTATION.md` to track your progress through each phase.

## Key Implementation Files

- `FIREBASE_IMPLEMENTATION.md` - Detailed checklist
- `.env.example` - Environment template
- `.env` - Your actual environment (create this)
- This guide for quick reference

## Next Steps
1. Complete environment setup
2. Start with Phase 1 in the implementation plan
3. Check off tasks as you complete them

## Need Help?
- Check Firebase documentation: https://rnfirebase.io/
- Review the implementation plan for detailed steps
- Each phase builds on the previous one