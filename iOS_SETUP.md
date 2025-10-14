# iOS Configuration for Firebase

## Firebase iOS Setup Steps

### 1. Download GoogleService-Info.plist
- From Firebase Console → Project Settings → iOS App
- Download `GoogleService-Info.plist`

### 2. Add to iOS Project
```bash
# Create ios folder if it doesn't exist
mkdir -p ios

# Place the GoogleService-Info.plist file in the ios folder
# ios/GoogleService-Info.plist
```

### 3. Configure ios/Podfile
Add Firebase pods to your Podfile:

```ruby
# ios/Podfile
require File.join(File.dirname(`node --print "require.resolve('expo/package.json')"`), "scripts/autolinking")
require File.join(File.dirname(`node --print "require.resolve('react-native/package.json')"`), "scripts/react_native_pods")

platform :ios, '13.4'
install! 'cocoapods', :deterministic_uuids => false

target 'VMStock' do
  use_expo_modules!
  config = use_native_modules!

  use_react_native!(
    :path => config[:reactNativePath],
    :hermes_enabled => true,
    :fabric_enabled => flags[:fabric_enabled],
    :app_clip => false
  )

  # Firebase pods
  pod 'Firebase', :modular_headers => true
  pod 'FirebaseCoreInternal', :modular_headers => true
  pod 'GoogleUtilities', :modular_headers => true

  post_install do |installer|
    react_native_post_install(
      installer,
      config[:reactNativePath],
      :mac_catalyst_enabled => false
    )
  end
end
```

### 4. Update app.json for iOS
```json
{
  "expo": {
    "ios": {
      "supportsTablet": true,
      "bundleIdentifier": "com.swill85.VMStock",
      "googleServicesFile": "./ios/GoogleService-Info.plist"
    }
  }
}
```

### 5. Install iOS Dependencies
```bash
cd ios
pod install
cd ..
```

## Notes
- Bundle ID must match Firebase console: `com.swill85.VMStock`
- GoogleService-Info.plist contains your iOS-specific Firebase configuration
- Pods will be installed automatically when you run the app