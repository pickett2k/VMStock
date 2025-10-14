# SumUp Payment Integration Guide

## Overview
This document outlines the implementation of SumUp payment functionality in the VMStock app, supporting both hardware device integration (Android) and NFC Tap-to-Pay (iOS/Android).

## SumUp Integration Options

### 1. SumUp SDK (Recommended)
- **Android**: Full device integration + NFC Tap-to-Pay
- **iOS**: NFC Tap-to-Pay only (Apple restrictions prevent direct hardware integration)
- **Web**: SumUp Checkout API for web fallback

### 2. SumUp API Endpoints
- **Payment Processing API**: Handle transactions
- **Merchant API**: Get merchant info, transaction history
- **Webhook API**: Real-time payment notifications

## Required SumUp Credentials

Add these to your `.env` file:

```bash
# SumUp Configuration
SUMUP_APP_ID=your_app_id_here
SUMUP_APP_SECRET=your_app_secret_here
SUMUP_MERCHANT_CODE=your_merchant_code_here
SUMUP_API_KEY=your_api_key_here

# Environment (sandbox/production)
SUMUP_ENVIRONMENT=sandbox

# Optional: Webhook configuration
SUMUP_WEBHOOK_SECRET=your_webhook_secret_here
```

## Getting SumUp Credentials

### Step 1: SumUp Developer Account
1. Go to [SumUp Developer Portal](https://developer.sumup.com/)
2. Create developer account
3. Register your application

### Step 2: App Registration
```json
{
  "name": "VMStock POS System",
  "description": "Stock management and billing system with integrated payments",
  "redirect_uris": ["vmstock://sumup-callback"],
  "scopes": [
    "payments",
    "transactions.history",
    "user.profile",
    "user.payout-settings"
  ]
}
```

### Step 3: Merchant Setup
- Link your existing SumUp merchant account
- Configure payment methods (card, NFC, etc.)
- Set up webhooks for real-time notifications

## Implementation Architecture

### Payment Flow
```
1. User selects "Pay Bill" in app
2. Choose payment method:
   - Hardware Device (Android only)
   - NFC Tap-to-Pay (iOS/Android)
   - Manual "Mark as Paid"
3. Process payment through SumUp SDK
4. Update Firebase with payment status
5. Sync payment confirmation
```

## Required Dependencies

### React Native Packages
```bash
# Core SumUp SDK
npm install @sumup/react-native-sumup-sdk

# NFC Support
npm install react-native-nfc-manager

# Permissions
npm install react-native-permissions

# Environment variables
npm install react-native-config

# Payment UI components
npm install react-native-elements
```

### iOS Setup
```xml
<!-- ios/VMStock/Info.plist -->
<key>NFCReaderUsageDescription</key>
<string>Enable NFC to accept contactless payments</string>

<key>NSLocationWhenInUseUsageDescription</key>
<string>Location required for payment processing compliance</string>

<!-- URL Scheme for SumUp callbacks -->
<key>CFBundleURLTypes</key>
<array>
  <dict>
    <key>CFBundleURLName</key>
    <string>sumup-callback</string>
    <key>CFBundleURLSchemes</key>
    <array>
      <string>vmstock</string>
    </array>
  </dict>
</array>
```

### Android Setup
```xml
<!-- android/app/src/main/AndroidManifest.xml -->
<uses-permission android:name="android.permission.NFC" />
<uses-permission android:name="android.permission.ACCESS_FINE_LOCATION" />
<uses-permission android:name="android.permission.BLUETOOTH" />
<uses-permission android:name="android.permission.BLUETOOTH_ADMIN" />

<!-- NFC Feature -->
<uses-feature
    android:name="android.hardware.nfc"
    android:required="false" />

<!-- SumUp Intent Filter -->
<activity
    android:name=".MainActivity"
    android:exported="true">
    <intent-filter>
        <action android:name="android.intent.action.VIEW" />
        <category android:name="android.intent.category.DEFAULT" />
        <category android:name="android.intent.category.BROWSABLE" />
        <data android:scheme="vmstock" />
    </intent-filter>
</activity>
```

## Payment Service Implementation

### 1. PaymentService.ts
```typescript
interface PaymentMethod {
  id: string;
  name: string;
  type: 'hardware' | 'nfc' | 'manual';
  available: boolean;
  icon: string;
}

interface PaymentRequest {
  amount: number;
  currency: string;
  description: string;
  playerId: string;
  assignmentIds: string[];
}

interface PaymentResult {
  success: boolean;
  transactionId?: string;
  method: string;
  amount: number;
  timestamp: number;
  error?: string;
}

class PaymentService {
  async getAvailablePaymentMethods(): Promise<PaymentMethod[]>
  async processPayment(request: PaymentRequest, method: PaymentMethod): Promise<PaymentResult>
  async initializeSumUp(): Promise<boolean>
  async processNFCPayment(amount: number): Promise<PaymentResult>
  async processHardwarePayment(amount: number): Promise<PaymentResult>
  async manualPayment(amount: number): Promise<PaymentResult>
}
```

### 2. Payment Configuration
```typescript
interface PaymentConfig {
  sumUpEnabled: boolean;
  nfcEnabled: boolean;
  hardwareEnabled: boolean;
  manualPaymentEnabled: boolean;
  maxPaymentAmount: number;
  currency: string;
  merchantName: string;
}
```

## UI Components

### 1. PaymentMethodSelector
- List available payment methods
- Show method availability (NFC supported, device connected, etc.)
- Method-specific icons and descriptions

### 2. PaymentProcessingScreen
- Real-time payment status
- Progress indicators for different methods
- Success/error handling with clear messaging

### 3. PaymentConfirmation
- Receipt-style confirmation
- Transaction details
- Option to send receipt via email/SMS

## Integration Points

### Firebase Integration
```typescript
interface PaymentRecord {
  id: string;
  playerId: string;
  assignmentIds: string[];
  amount: number;
  currency: string;
  method: 'sumup_hardware' | 'sumup_nfc' | 'manual';
  transactionId?: string;
  status: 'pending' | 'completed' | 'failed' | 'cancelled';
  timestamp: number;
  receiptUrl?: string;
}
```

### Player Bills Integration
- Add "Pay Now" buttons to UserSummary
- Support partial payments
- Real-time balance updates
- Payment history tracking

## Security Considerations

### 1. PCI Compliance
- SumUp handles card data (PCI DSS Level 1)
- No sensitive payment data stored in app
- Use SumUp's secure tokenization

### 2. Authentication
- Merchant authentication via SumUp
- Transaction verification
- Webhook signature validation

### 3. Data Protection
- Encrypt payment logs
- Secure API key storage
- Audit trail for all transactions

## Feature Toggles

### Admin Settings
```typescript
interface PaymentSettings {
  enableSumUpIntegration: boolean;
  enableNFCPayments: boolean;
  enableHardwarePayments: boolean;
  enableManualPayments: boolean;
  requireReceiptEmail: boolean;
  autoMarkAsPaid: boolean;
}
```

### Environment-Based Config
```typescript
const PAYMENT_CONFIG = {
  development: {
    sumUpEnvironment: 'sandbox',
    enableAllMethods: true,
    maxAmount: 100.00
  },
  production: {
    sumUpEnvironment: 'production',
    enableAllMethods: true,
    maxAmount: 1000.00
  }
};
```

## Implementation Phases

### ✅ Phase 1: Setup & Configuration (COMPLETED)
- [x] Environment variables configuration (.env.example created)
- [x] Basic service architecture (PaymentService.ts)
- [x] Payment interfaces & types defined
- [ ] SumUp developer account setup (USER ACTION REQUIRED)

### ✅ Phase 2: Manual Payments (COMPLETED)
- [x] Enhanced manual payment flow
- [x] Payment confirmation UI (PaymentModal.tsx)
- [x] Firebase integration structure
- [x] Professional UI design with dark mode

### 🚀 Phase 3: Android Focus - NFC & Hardware (CURRENT PRIORITY)
- [ ] Install SumUp React Native SDK
- [ ] Configure Android permissions & manifest
- [ ] NFC capability detection & initialization
- [ ] SumUp NFC SDK integration
- [ ] Hardware device pairing (Android)
- [ ] Payment processing flow
- [ ] Error handling & retry logic
- [ ] Connection management

### Phase 4: Testing & Validation
- [ ] Sandbox environment testing
- [ ] Real device testing with SumUp hardware
- [ ] NFC payment testing
- [ ] Error scenario validation
- [ ] Performance optimization

### Phase 5: Advanced Features (Future)
- [ ] Partial payments
- [ ] Payment history
- [ ] Refunds/cancellations
- [ ] Analytics & reporting

## Testing Strategy

### Sandbox Testing
- Use SumUp sandbox environment
- Test all payment methods
- Verify webhook handling
- Test error scenarios

### Device Testing
- Test on multiple Android devices
- Test NFC on various iOS devices
- Test with actual SumUp hardware
- Performance testing with concurrent payments

## Cost Considerations

### SumUp Fees
- Card payments: ~1.95% + fixed fee
- Contactless: Same rate
- Hardware rental: Monthly fee
- API usage: Usually free for merchants

### Development Costs
- SDK integration: ~2-3 weeks
- UI/UX design: ~1 week
- Testing & validation: ~1-2 weeks
- Certification: Variable

## Support & Maintenance

### Monitoring
- Payment success/failure rates
- Transaction processing times
- Device connectivity status
- API response times

### Error Handling
- Network connectivity issues
- Device pairing problems
- Payment declines
- API rate limiting

## Next Steps

1. **Register SumUp Developer Account**
   - Complete merchant verification
   - Get API credentials
   - Set up sandbox environment

2. **Basic Integration POC**
   - Install required dependencies
   - Implement basic payment flow
   - Test with sandbox

3. **UI/UX Design**
   - Design payment method selection
   - Create processing screens
   - Design receipt/confirmation flow

4. **Full Implementation**
   - Implement all payment methods
   - Add feature toggles
   - Complete testing

## Resources

- [SumUp Developer Documentation](https://developer.sumup.com/)
- [SumUp React Native SDK](https://github.com/sumup/sumup-react-native-sdk)
- [SumUp API Reference](https://developer.sumup.com/rest-api/)
- [PCI DSS Compliance Guide](https://www.pcisecuritystandards.org/)

---

*This implementation will provide a comprehensive payment solution that maintains manual payment flexibility while adding modern NFC and hardware payment capabilities.*