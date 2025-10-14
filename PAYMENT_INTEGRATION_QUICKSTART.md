# Quick Payment Integration Guide

## 1. Add PaymentModal to UserSummary.tsx

### Import the PaymentModal
```typescript
import PaymentModal from './PaymentModal';
import { PaymentResult } from '../services/PaymentService';
```

### Add state variables to UserSummary component
```typescript
const [showPaymentModal, setShowPaymentModal] = useState(false);
const [paymentPlayer, setPaymentPlayer] = useState<PlayerTotal | null>(null);
```

### Add payment handler functions
```typescript
const handlePayNow = (player: PlayerTotal) => {
  setPaymentPlayer(player);
  setShowPaymentModal(true);
};

const handlePaymentComplete = async (result: PaymentResult) => {
  if (result.success && paymentPlayer) {
    // Mark assignments as paid
    for (const assignment of paymentPlayer.assignments) {
      if (assignment.id) {
        await hybridSyncService.updateAssignment(assignment.id, { paid: true });
      }
    }
    
    // Reload data
    await loadAssignments();
    
    // Log the payment
    console.log('Payment completed:', result);
  }
};
```

### Add "Pay Now" button to player cards

Replace the existing Mark Paid button with:

```tsx
<View style={styles.buttonContainer}>
  <TouchableOpacity
    style={[styles.breakdownButton, isDarkMode && styles.darkBreakdownButton]}
    onPress={() => handleViewBreakdown(item)}
  >
    <Icon name="format-list-bulleted" size={16} color={isDarkMode ? '#fff' : '#007AFF'} />
    <Text style={[styles.breakdownButtonText, isDarkMode && styles.darkBreakdownButtonText]}>
      View Breakdown
    </Text>
  </TouchableOpacity>
  
  <TouchableOpacity
    style={[styles.payNowButton, isDarkMode && styles.darkPayNowButton]}
    onPress={() => handlePayNow(item)}
  >
    <Icon name="credit-card" size={16} color="#fff" />
    <Text style={styles.payNowButtonText}>Pay Now</Text>
  </TouchableOpacity>
</View>
```

### Add PaymentModal to the component JSX

Add this before the closing </View> of the main component:

```tsx
{/* Payment Modal */}
<PaymentModal
  visible={showPaymentModal}
  onClose={() => {
    setShowPaymentModal(false);
    setPaymentPlayer(null);
  }}
  playerName={paymentPlayer?.name || ''}
  amount={paymentPlayer?.total || 0}
  assignmentIds={paymentPlayer?.assignments.map(a => a.id).filter(Boolean) as string[] || []}
  playerId={paymentPlayer?.name || ''}
  onPaymentComplete={handlePaymentComplete}
/>
```

### Add new button styles

Add these to your StyleSheet:

```typescript
payNowButton: {
  flex: 1,
  flexDirection: 'row',
  alignItems: 'center',
  justifyContent: 'center',
  backgroundColor: '#007AFF',
  paddingVertical: 10,
  paddingHorizontal: 16,
  borderRadius: 8,
  gap: 6,
},
darkPayNowButton: {
  backgroundColor: '#0066CC',
},
payNowButtonText: {
  color: '#fff',
  fontSize: 14,
  fontWeight: '600',
},
```

## 2. Payment Configuration (Optional)

### Enable/Disable Payment Methods

You can control which payment methods are available by updating the PaymentService settings:

```typescript
import { paymentService } from '../services/PaymentService';

// In your component or app initialization
paymentService.updateSettings({
  enableSumUpIntegration: true,  // Enable SumUp features
  enableNFCPayments: true,       // Enable NFC tap-to-pay
  enableHardwarePayments: true,  // Enable hardware device (Android only)
  enableManualPayments: true,    // Keep manual "mark as paid" option
  maxPaymentAmount: 500.00,      // Set maximum payment amount
  currency: 'GBP'                // Set currency
});
```

## 3. Install Required Dependencies (When Ready)

When you're ready to implement actual SumUp integration:

```bash
# SumUp SDK
npm install @sumup/react-native-sumup-sdk

# NFC Support
npm install react-native-nfc-manager

# Environment variables
npm install react-native-config

# Follow platform-specific setup instructions in SUMUP_PAYMENT_INTEGRATION.md
```

## 4. Environment Variables

Create a `.env` file in your project root:

```bash
SUMUP_ENABLED=true
SUMUP_APP_ID=your_actual_app_id
SUMUP_MERCHANT_CODE=your_merchant_code
SUMUP_ENVIRONMENT=sandbox
```

## 5. Testing

### Current Implementation
- Manual payments work immediately
- UI shows all payment methods
- Simulated NFC/hardware payments for testing

### With SumUp Integration
- Replace simulated payments with actual SumUp SDK calls
- Test in SumUp sandbox environment first
- Verify all payment methods on target devices

## 6. Next Steps

1. **Implement basic PaymentModal** - Add to UserSummary as shown above
2. **Test manual payments** - Verify the flow works with your existing system
3. **Get SumUp credentials** - Register with SumUp developer portal
4. **Install SumUp SDK** - Add actual payment processing
5. **Test with hardware** - Verify NFC and device payments work
6. **Production deployment** - Switch to production environment

The PaymentModal is designed to work immediately with manual payments and can be enhanced with actual SumUp integration when you're ready!