# Android Configuration for Firebase

## Firebase Android Setup Steps

### 1. Download google-services.json
- From Firebase Console → Project Settings → Android App
- Download `google-services.json`

### 2. Add to Android Project
```bash
# Create android/app folder if it doesn't exist
mkdir -p android/app

# Place the google-services.json file in android/app folder
# android/app/google-services.json
```

### 3. Configure android/build.gradle (Project level)
```gradle
// android/build.gradle
buildscript {
    ext {
        buildToolsVersion = "34.0.0"
        minSdkVersion = 23
        compileSdkVersion = 34
        targetSdkVersion = 34
        ndkVersion = "25.1.8937393"
        kotlinVersion = "1.9.10"
    }
    dependencies {
        classpath("com.android.tools.build:gradle")
        classpath("com.facebook.react:react-native-gradle-plugin")
        classpath("org.jetbrains.kotlin:kotlin-gradle-plugin")
        
        // Firebase
        classpath 'com.google.gms:google-services:4.4.0'
    }
}
```

### 4. Configure android/app/build.gradle (App level)
```gradle
// android/app/build.gradle
apply plugin: "com.android.application"
apply plugin: "org.jetbrains.kotlin.android"
apply plugin: "com.facebook.react"

// Add Firebase plugin
apply plugin: 'com.google.gms.google-services'

android {
    ndkVersion rootProject.ext.ndkVersion
    compileSdkVersion rootProject.ext.compileSdkVersion

    namespace "com.swill85.vmstock"
    defaultConfig {
        applicationId "com.swill85.VMStock"
        minSdkVersion rootProject.ext.minSdkVersion
        targetSdkVersion rootProject.ext.targetSdkVersion
        versionCode 1
        versionName "1.0.0"
    }
    
    // ... rest of your config
}

dependencies {
    implementation("com.facebook.react:react-android")
    
    // Firebase
    implementation platform('com.google.firebase:firebase-bom:32.7.0')
    implementation 'com.google.firebase:firebase-analytics'
    implementation 'com.google.firebase:firebase-crashlytics'
    
    if (hermesEnabled.toBoolean()) {
        implementation("com.facebook.react:hermes-android")
    } else {
        implementation jscFlavor
    }
}
```

### 5. Update app.json for Android
```json
{
  "expo": {
    "android": {
      "adaptiveIcon": {
        "foregroundImage": "./assets/images/app-icon.png",
        "backgroundColor": "#ffffff"
      },
      "package": "com.swill85.VMStock",
      "googleServicesFile": "./android/app/google-services.json"
    }
  }
}
```

### 6. Configure MainApplication.java (if needed)
```java
// android/app/src/main/java/com/swill85/vmstock/MainApplication.java
package com.swill85.vmstock;

import android.app.Application;
import com.facebook.react.PackageList;
import com.facebook.react.ReactApplication;
import com.facebook.react.ReactHost;
import com.facebook.react.ReactNativeHost;
import com.facebook.react.ReactPackage;
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint;
import com.facebook.react.defaults.DefaultReactHost;
import com.facebook.react.defaults.DefaultReactNativeHost;
import com.facebook.soloader.SoLoader;
import java.util.List;

// Firebase
import io.invertase.firebase.app.ReactNativeFirebaseAppPackage;

public class MainApplication extends Application implements ReactApplication {

  private final ReactNativeHost mReactNativeHost =
      new DefaultReactNativeHost(this) {
        @Override
        public boolean getUseDeveloperSupport() {
          return BuildConfig.DEBUG;
        }

        @Override
        protected List<ReactPackage> getPackages() {
          @SuppressWarnings("UnnecessaryLocalVariable")
          List<ReactPackage> packages = new PackageList(this).getPackages();
          
          // Firebase packages are auto-linked
          
          return packages;
        }

        @Override
        protected String getJSMainModuleName() {
          return "index";
        }

        @Override
        protected boolean isNewArchEnabled() {
          return BuildConfig.IS_NEW_ARCHITECTURE_ENABLED;
        }

        @Override
        protected Boolean isHermesEnabled() {
          return BuildConfig.IS_HERMES_ENABLED;
        }
      };

  @Override
  public ReactNativeHost getReactNativeHost() {
    return mReactNativeHost;
  }

  @Override
  public void onCreate() {
    super.onCreate();
    SoLoader.init(this, /* native exopackage */ false);
    if (BuildConfig.IS_NEW_ARCHITECTURE_ENABLED) {
      DefaultNewArchitectureEntryPoint.load();
    }
  }
}
```

## Notes
- Package name must match Firebase console: `com.swill85.VMStock`
- google-services.json contains your Android-specific Firebase configuration
- Google Services plugin will automatically configure Firebase services