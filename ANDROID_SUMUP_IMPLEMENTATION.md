# Android SumUp Integration - Step by Step

## 🎯 Current Focus: Android NFC + Hardware Device Integration

### ✅ What's Already Complete
- [x] PaymentService.ts - Core payment logic
- [x] PaymentModal.tsx - Professional UI component  
- [x] Environment configuration (.env.example)
- [x] Manual payment flow (working now)
- [x] TypeScript interfaces & types

## 📱 Android Implementation Steps

### Step 1: Install Required Dependencies

```bash
# SumUp SDK for React Native
npm install @sumup/react-native-sumup-sdk

# NFC Manager for device capabilities
npm install react-native-nfc-manager

# Environment variables
npm install react-native-config

# Permissions handling
npm install react-native-permissions

# Auto-linking (React Native 0.60+)
cd android && ./gradlew clean && cd ..
```

### Step 2: Android Configuration

#### android/app/src/main/AndroidManifest.xml
```xml
<!-- ADD THESE PERMISSIONS -->
<uses-permission android:name="android.permission.NFC" />
<uses-permission android:name="android.permission.ACCESS_FINE_LOCATION" />
<uses-permission android:name="android.permission.BLUETOOTH" />
<uses-permission android:name="android.permission.BLUETOOTH_ADMIN" />
<uses-permission android:name="android.permission.BLUETOOTH_CONNECT" />
<uses-permission android:name="android.permission.ACCESS_COARSE_LOCATION" />

<!-- NFC Feature (not required - fallback to manual if unavailable) -->
<uses-feature
    android:name="android.hardware.nfc"
    android:required="false" />

<!-- SumUp Activity (ADD TO EXISTING <application> TAG) -->
<activity
    android:name="com.sumup.merchant.reader.activities.SumUpActivity"
    android:exported="false"
    android:theme="@style/Theme.AppCompat.Light.NoActionBar" />

<!-- URL Scheme for SumUp callbacks -->
<activity
    android:name=".MainActivity"
    android:exported="true">
    <!-- EXISTING INTENT FILTERS HERE -->
    
    <!-- ADD THIS NEW INTENT FILTER -->
    <intent-filter>
        <action android:name="android.intent.action.VIEW" />
        <category android:name="android.intent.category.DEFAULT" />
        <category android:name="android.intent.category.BROWSABLE" />
        <data android:scheme="vmstock" />
    </intent-filter>
</activity>
```

#### android/app/build.gradle
```gradle
// ADD TO dependencies block
dependencies {
    implementation 'com.sumup.merchant.reader:merchant-reader:4.+'
    // ... existing dependencies
}
```

### Step 3: Environment Setup

Create `.env` file in project root:
```bash
# SumUp Configuration
SUMUP_ENABLED=true
SUMUP_APP_ID=com.vmstock.pos
SUMUP_ENVIRONMENT=sandbox
SUMUP_MERCHANT_CODE=MERCHANT_CODE_FROM_SUMUP

# Get these from SumUp Developer Portal:
# https://developer.sumup.com/
SUMUP_ACCESS_TOKEN=your_access_token_here
```

### Step 4: Enhanced PaymentService (Android-Specific)

Create this file: `services/AndroidPaymentService.ts`

```typescript
/* 
 * COMMENTED OUT - Remove comments when ready to integrate
 * This service handles Android-specific SumUp integration
 */

/*
import { NativeModules, Platform } from 'react-native';
import NfcManager, { NfcTech } from 'react-native-nfc-manager';
import { check, request, PERMISSIONS, RESULTS } from 'react-native-permissions';

const { SumUpSDK } = NativeModules;

export class AndroidPaymentService {
  private isInitialized = false;
  private deviceConnected = false;

  async initialize(): Promise<boolean> {
    if (Platform.OS !== 'android') return false;
    
    try {
      // Initialize SumUp SDK
      await SumUpSDK.authenticate(
        Config.SUMUP_ACCESS_TOKEN,
        Config.SUMUP_ENVIRONMENT || 'sandbox'
      );
      
      // Check NFC availability
      const nfcSupported = await NfcManager.isSupported();
      const nfcEnabled = await NfcManager.isEnabled();
      
      console.log('SumUp initialized:', {
        nfcSupported,
        nfcEnabled,
        environment: Config.SUMUP_ENVIRONMENT
      });
      
      this.isInitialized = true;
      return true;
    } catch (error) {
      console.error('Failed to initialize Android payment service:', error);
      return false;
    }
  }

  async checkDeviceCapabilities() {
    const capabilities = {
      nfcSupported: false,
      nfcEnabled: false,
      bluetoothEnabled: false,
      locationPermission: false,
      sumupDeviceConnected: false
    };

    try {
      // Check NFC
      capabilities.nfcSupported = await NfcManager.isSupported();
      capabilities.nfcEnabled = await NfcManager.isEnabled();

      // Check permissions
      const locationStatus = await check(PERMISSIONS.ANDROID.ACCESS_FINE_LOCATION);
      capabilities.locationPermission = locationStatus === RESULTS.GRANTED;

      // Check SumUp device connection
      const connectedDevices = await SumUpSDK.getConnectedReaders();
      capabilities.sumupDeviceConnected = connectedDevices.length > 0;

    } catch (error) {
      console.error('Error checking device capabilities:', error);
    }

    return capabilities;
  }

  async requestPermissions(): Promise<boolean> {
    try {
      const permissions = [
        PERMISSIONS.ANDROID.ACCESS_FINE_LOCATION,
        PERMISSIONS.ANDROID.BLUETOOTH_CONNECT,
        PERMISSIONS.ANDROID.NFC
      ];

      const results = await Promise.all(
        permissions.map(permission => request(permission))
      );

      return results.every(result => 
        result === RESULTS.GRANTED || result === RESULTS.UNAVAILABLE
      );
    } catch (error) {
      console.error('Permission request failed:', error);
      return false;
    }
  }

  async processNFCPayment(amount: number): Promise<any> {
    try {
      const result = await SumUpSDK.checkout({
        total: amount,
        currency: 'GBP',
        title: 'VMStock Payment'
      });

      return {
        success: true,
        transactionId: result.transaction_code,
        amount: amount,
        cardType: result.card_type,
        lastFour: result.card_last_4_digits
      };
    } catch (error) {
      throw new Error(`NFC Payment failed: ${error.message}`);
    }
  }

  async processHardwarePayment(amount: number): Promise<any> {
    try {
      const result = await SumUpSDK.checkoutWithReader({
        total: amount,
        currency: 'GBP',
        title: 'VMStock Payment'
      });

      return {
        success: true,
        transactionId: result.transaction_code,
        amount: amount,
        cardType: result.card_type,
        lastFour: result.card_last_4_digits
      };
    } catch (error) {
      throw new Error(`Hardware payment failed: ${error.message}`);
    }
  }

  async pairSumUpDevice(): Promise<boolean> {
    try {
      await SumUpSDK.prepareForCheckout();
      // This opens SumUp's device pairing UI
      return true;
    } catch (error) {
      console.error('Device pairing failed:', error);
      return false;
    }
  }
}

export const androidPaymentService = new AndroidPaymentService();
*/

// PLACEHOLDER - This service is ready for implementation
// Remove comments above when ready to integrate SumUp SDK

export class AndroidPaymentService {
  async initialize(): Promise<boolean> {
    console.log('AndroidPaymentService: Placeholder - not yet integrated');
    return false;
  }

  async checkDeviceCapabilities() {
    return {
      nfcSupported: false,
      nfcEnabled: false,
      bluetoothEnabled: false,
      locationPermission: false,
      sumupDeviceConnected: false
    };
  }
}

export const androidPaymentService = new AndroidPaymentService();
```

### Step 5: Device Setup Component (Commented Out)

Create: `components/SumUpDeviceSetup.tsx`

```typescript
/*
 * COMMENTED OUT - Device setup component for SumUp integration
 * Remove comments when ready to integrate
 */

/*
import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Alert,
  Switch
} from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { androidPaymentService } from '../services/AndroidPaymentService';

export default function SumUpDeviceSetup() {
  const [capabilities, setCapabilities] = useState({
    nfcSupported: false,
    nfcEnabled: false,
    bluetoothEnabled: false,
    locationPermission: false,
    sumupDeviceConnected: false
  });
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    checkCapabilities();
  }, []);

  const checkCapabilities = async () => {
    setLoading(true);
    try {
      const caps = await androidPaymentService.checkDeviceCapabilities();
      setCapabilities(caps);
    } catch (error) {
      console.error('Failed to check capabilities:', error);
    } finally {
      setLoading(false);
    }
  };

  const handlePairDevice = async () => {
    try {
      const success = await androidPaymentService.pairSumUpDevice();
      if (success) {
        Alert.alert('Success', 'Device paired successfully');
        checkCapabilities();
      }
    } catch (error) {
      Alert.alert('Error', 'Failed to pair device');
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>SumUp Device Setup</Text>
      
      <View style={styles.capabilityItem}>
        <Icon name="nfc" size={24} color={capabilities.nfcSupported ? '#4CAF50' : '#ccc'} />
        <Text style={styles.capabilityText}>NFC Supported</Text>
        <Switch value={capabilities.nfcSupported} disabled />
      </View>

      <View style={styles.capabilityItem}>
        <Icon name="bluetooth" size={24} color={capabilities.bluetoothEnabled ? '#4CAF50' : '#ccc'} />
        <Text style={styles.capabilityText}>Bluetooth</Text>
        <Switch value={capabilities.bluetoothEnabled} disabled />
      </View>

      <TouchableOpacity style={styles.pairButton} onPress={handlePairDevice}>
        <Icon name="link-variant" size={20} color="#fff" />
        <Text style={styles.pairButtonText}>Pair SumUp Device</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 20,
    backgroundColor: '#fff',
    borderRadius: 12,
    margin: 16
  },
  title: {
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 20
  },
  capabilityItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#eee'
  },
  capabilityText: {
    flex: 1,
    marginLeft: 12,
    fontSize: 16
  },
  pairButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#007AFF',
    paddingVertical: 12,
    borderRadius: 8,
    marginTop: 20,
    gap: 8
  },
  pairButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600'
  }
});
*/

// PLACEHOLDER COMPONENT - Remove comments when ready to implement
import React from 'react';
import { View, Text } from 'react-native';

export default function SumUpDeviceSetup() {
  return (
    <View style={{ padding: 20 }}>
      <Text>SumUp Device Setup - Implementation Placeholder</Text>
    </View>
  );
}
```

## 🎯 Next Steps for Android Integration

### 1. Get SumUp Developer Credentials
```bash
# Visit: https://developer.sumup.com/
# 1. Register developer account
# 2. Create new application
# 3. Get credentials:
#    - Application ID
#    - Access Token
#    - Merchant Code
```

### 2. Test Environment Setup
```bash
# 1. Add .env file with sandbox credentials
# 2. Install dependencies
# 3. Configure Android manifest
# 4. Test on Android device with NFC
```

### 3. Implementation Priority
```bash
# Phase 1: NFC Payments (Easiest to test)
# - No hardware device needed
# - Most Android phones support NFC
# - Quick to validate

# Phase 2: Hardware Device Integration
# - Requires actual SumUp card reader
# - More complex but full POS functionality
# - Better for high-volume transactions
```

### 4. Testing Strategy
```bash
# 1. Simulator Testing
#    - Test UI components
#    - Test manual payments
#    - Validate error handling

# 2. Device Testing (NFC)
#    - Test on Android phone with NFC
#    - Use test cards in sandbox
#    - Validate payment flow

# 3. Hardware Testing
#    - Test with SumUp card reader
#    - Test device pairing
#    - Validate full transaction flow
```

### 5. Feature Toggle Implementation
```typescript
// Add to your app settings
const PAYMENT_FEATURES = {
  SUMUP_ENABLED: __DEV__ ? false : true,  // Easy to disable
  ALLOW_MANUAL_PAYMENTS: true,            // Keep manual as fallback
  REQUIRE_NFC: false,                     // Graceful degradation
  REQUIRE_HARDWARE: false                 // Optional hardware
};

// Easy removal - just set SUMUP_ENABLED to false
// All SumUp components will hide automatically
```

## 🔧 Easy Removal Strategy

All SumUp integration is designed to be easily removable:

1. **Set `SUMUP_ENABLED=false`** in .env
2. **Comment out SumUp SDK imports** (already done)
3. **Manual payments continue working** normally
4. **No breaking changes** to existing functionality

The integration is built as an **enhancement**, not a replacement of existing payment tracking.

---

**Ready to start with Android NFC integration first?** It's the easiest to test and validate before moving to hardware devices.