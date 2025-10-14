import { Platform, Alert } from 'react-native';

// Conditional Stripe imports to prevent web bundling issues
let stripePaymentService: any = null;
let stripeTerminalService: any = null;

// Define types to prevent TypeScript errors
type StripePaymentResult = any;
type StripePaymentRequest = any;
type TerminalPaymentResult = any;

if (Platform.OS !== 'web') {
  try {
    const stripePayment = require('./StripePaymentService');
    stripePaymentService = stripePayment.stripePaymentService;
    
    const stripeTerminal = require('./StripeTerminalService');
    stripeTerminalService = stripeTerminal.stripeTerminalService;
  } catch (error) {
    console.warn('Stripe services not available:', error);
  }
}

// TODO: Install react-native-config and import properly
// import Config from 'react-native-config';

// Temporary config - replace with actual environment variables
const Config = {
  STRIPE_ENABLED: 'false',
  STRIPE_PUBLISHABLE_KEY: '',
  STRIPE_SECRET_KEY: '',
  STRIPE_TERMINAL_LOCATION_ID: '',
  STRIPE_ENVIRONMENT: 'test'
};

// Payment method types
export interface PaymentMethod {
  id: string;
  name: string;
  type: 'hardware' | 'nfc' | 'manual';
  available: boolean;
  icon: string;
  description: string;
}

export interface PaymentRequest {
  amount: number;
  currency: string;
  description: string;
  playerId: string;
  playerName: string;
  assignmentIds: string[];
}

export interface PaymentResult {
  success: boolean;
  transactionId?: string;
  method: string;
  amount: number;
  timestamp: number;
  error?: string;
  receiptData?: any;
}

export interface PaymentSettings {
  enableStripeIntegration: boolean;
  enableNFCPayments: boolean;
  enableHardwarePayments: boolean;
  enableManualPayments: boolean;
  requireReceiptEmail: boolean;
  autoMarkAsPaid: boolean;
  maxPaymentAmount: number;
  currency: string;
}

class PaymentService {
  private sumUpInitialized: boolean = false;
  private settings: PaymentSettings;

  constructor() {
    this.settings = {
      enableStripeIntegration: Config.STRIPE_ENABLED === 'true',
      enableNFCPayments: true,
      enableHardwarePayments: Platform.OS === 'android',
      enableManualPayments: true,
      requireReceiptEmail: false,
      autoMarkAsPaid: true,
      maxPaymentAmount: 1000.00,
      currency: 'GBP'
    };
  }

  /**
   * Initialize SumUp SDK
   */
  async initializeSumUp(): Promise<boolean> {
    try {
      if (!this.settings.enableStripeIntegration) {
        console.log('SumUp integration disabled');
        return false;
      }

      // TODO: Initialize SumUp SDK
      // const SumUpSDK = require('@sumup/react-native-sumup-sdk');
      // await SumUpSDK.init({
      //   appId: Config.SUMUP_APP_ID,
      //   merchantCode: Config.SUMUP_MERCHANT_CODE,
      //   environment: Config.SUMUP_ENVIRONMENT || 'sandbox'
      // });

      console.log('SumUp SDK initialized successfully');
      this.sumUpInitialized = true;
      return true;
    } catch (error) {
      console.error('Failed to initialize SumUp SDK:', error);
      return false;
    }
  }

  /**
   * Get available payment methods based on device capabilities and settings
   */
  async getAvailablePaymentMethods(): Promise<PaymentMethod[]> {
    const methods: PaymentMethod[] = [];

    // Manual payment (always available)
    if (this.settings.enableManualPayments) {
      methods.push({
        id: 'manual',
        name: 'Mark as Paid',
        type: 'manual',
        available: true,
        icon: 'check-circle',
        description: 'Manually mark payment as received'
      });
    }

    // Stripe card payment (existing)
    if (this.settings.enableStripeIntegration) {
      methods.push({
        id: 'stripe_card',
        name: 'Card Payment',
        type: 'manual',
        available: true,
        icon: 'credit-card',
        description: 'Pay with card via Stripe'
      });
    }

    // Stripe Terminal NFC Tap-to-Pay
    if (this.settings.enableNFCPayments) {
      const nfcAvailable = await stripeTerminalService.isNFCAvailable();
      methods.push({
        id: 'stripe_terminal_nfc',
        name: 'Tap to Pay (NFC)',
        type: 'nfc',
        available: nfcAvailable,
        icon: 'contactless-payment',
        description: 'Contactless card payment via NFC'
      });
    }

    // SumUp Hardware Device (Android only)
    if (this.settings.enableHardwarePayments && Platform.OS === 'android' && this.sumUpInitialized) {
      const deviceConnected = await this.checkHardwareDevice();
      methods.push({
        id: 'sumup_hardware',
        name: 'Card Reader',
        type: 'hardware',
        available: deviceConnected,
        icon: 'credit-card-outline',
        description: 'SumUp card reader device'
      });
    }

    return methods;
  }

  /**
   * Process payment using selected method
   */
  async processPayment(request: PaymentRequest, method: PaymentMethod): Promise<PaymentResult> {
    try {
      console.log(`Processing payment via ${method.name}:`, {
        amount: request.amount,
        currency: request.currency,
        player: request.playerName
      });

      let result: PaymentResult;

      switch (method.id) {
        case 'manual':
          result = await this.processManualPayment(request);
          break;
        case 'stripe_card':
          result = await this.processStripeCardPayment(request);
          break;
        case 'stripe_terminal_nfc':
          result = await this.processStripeTerminalNFC(request);
          break;
        case 'sumup_nfc':
          result = await this.processNFCPayment(request);
          break;
        case 'sumup_hardware':
          result = await this.processHardwarePayment(request);
          break;
        default:
          throw new Error(`Unsupported payment method: ${method.id}`);
      }

      if (result.success) {
        await this.logPaymentSuccess(request, result, method);
      }

      return result;
    } catch (error: any) {
      console.error('Payment processing failed:', error);
      return {
        success: false,
        method: method.id,
        amount: request.amount,
        timestamp: Date.now(),
        error: error.message || 'Payment processing failed'
      };
    }
  }

  /**
   * Process manual payment (admin marks as paid)
   */
  private async processManualPayment(request: PaymentRequest): Promise<PaymentResult> {
    return new Promise((resolve) => {
      Alert.alert(
        'Confirm Payment',
        `Mark £${request.amount.toFixed(2)} payment from ${request.playerName} as received?`,
        [
          {
            text: 'Cancel',
            style: 'cancel',
            onPress: () => resolve({
              success: false,
              method: 'manual',
              amount: request.amount,
              timestamp: Date.now(),
              error: 'Payment cancelled by user'
            })
          },
          {
            text: 'Confirm',
            onPress: () => resolve({
              success: true,
              transactionId: `manual_${Date.now()}`,
              method: 'manual',
              amount: request.amount,
              timestamp: Date.now()
            })
          }
        ]
      );
    });
  }

  /**
   * Process Stripe card payment (existing implementation)
   */
  private async processStripeCardPayment(request: PaymentRequest): Promise<PaymentResult> {
    try {
      console.log(`💳 Processing Stripe card payment for ${request.playerName}: £${request.amount.toFixed(2)}`);
      
      // Convert amount to pence for Stripe
      const amountInPence = Math.round(request.amount * 100);
      
      const stripeRequest: StripePaymentRequest = {
        amount: amountInPence,
        currency: request.currency.toLowerCase(),
        description: `Payment from ${request.playerName}`,
        metadata: {
          playerId: request.playerId,
          playerName: request.playerName,
          assignmentIds: request.assignmentIds.join(',')
        }
      };

      const stripeResult = await stripePaymentService.processManualEntry(stripeRequest);

      if (stripeResult.success) {
        return {
          success: true,
          transactionId: stripeResult.paymentIntentId,
          method: 'stripe_card',
          amount: request.amount,
          timestamp: Date.now(),
          receiptData: {
            paymentIntentId: stripeResult.paymentIntentId,
            paymentMethod: stripeResult.paymentMethod
          }
        };
      } else {
        throw new Error(stripeResult.error || 'Stripe payment failed');
      }
    } catch (error: any) {
      console.error('❌ Stripe card payment failed:', error);
      return {
        success: false,
        method: 'stripe_card',
        amount: request.amount,
        timestamp: Date.now(),
        error: error.message || 'Stripe card payment failed'
      };
    }
  }

  /**
   * Process Stripe Terminal NFC payment
   */
  private async processStripeTerminalNFC(request: PaymentRequest): Promise<PaymentResult> {
    try {
      console.log(`📱 Processing Stripe Terminal NFC payment for ${request.playerName}: £${request.amount.toFixed(2)}`);
      
      // Initialize Terminal SDK if not already done
      const initialized = await stripeTerminalService.initialize();
      if (!initialized) {
        throw new Error('Failed to initialize Stripe Terminal SDK');
      }

      // Discover and connect to NFC reader
      const readers = await stripeTerminalService.discoverReaders();
      if (readers.length === 0) {
        throw new Error('No NFC-capable readers found');
      }

      const connected = await stripeTerminalService.connectReader(readers[0]);
      if (!connected) {
        throw new Error('Failed to connect to NFC reader');
      }

      // Convert amount to smallest currency unit (pence)
      const amountInPence = Math.round(request.amount * 100);

      // Process the NFC payment
      const terminalResult = await stripeTerminalService.processNFCPayment({
        amount: amountInPence,
        currency: request.currency,
        description: request.description,
        playerId: request.playerId,
        playerName: request.playerName,
      });

      if (terminalResult.success) {
        return {
          success: true,
          transactionId: terminalResult.transactionId,
          method: 'stripe_terminal_nfc',
          amount: request.amount,
          timestamp: Date.now(),
          receiptData: {
            paymentIntentId: terminalResult.paymentIntent?.id,
            readerType: 'nfc'
          }
        };
      } else {
        throw new Error(terminalResult.error || 'NFC payment failed');
      }
    } catch (error: any) {
      console.error('❌ Stripe Terminal NFC payment failed:', error);
      return {
        success: false,
        method: 'stripe_terminal_nfc',
        amount: request.amount,
        timestamp: Date.now(),
        error: error.message || 'NFC payment failed'
      };
    }
  }

  /**
   * Process NFC contactless payment
   */
  private async processNFCPayment(request: PaymentRequest): Promise<PaymentResult> {
    try {
      // TODO: Implement SumUp NFC payment
      // const SumUpSDK = require('@sumup/react-native-sumup-sdk');
      // const result = await SumUpSDK.checkout({
      //   total: request.amount,
      //   currency: request.currency,
      //   title: request.description
      // });

      // For now, simulate the payment process
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Simulate success/failure
      const success = Math.random() > 0.1; // 90% success rate for demo

      if (success) {
        return {
          success: true,
          transactionId: `nfc_${Date.now()}`,
          method: 'sumup_nfc',
          amount: request.amount,
          timestamp: Date.now(),
          receiptData: {
            cardType: 'Visa',
            lastFour: '****1234',
            authCode: 'AUTH123'
          }
        };
      } else {
        throw new Error('Payment declined by card issuer');
      }
    } catch (error: any) {
      return {
        success: false,
        method: 'sumup_nfc',
        amount: request.amount,
        timestamp: Date.now(),
        error: error.message || 'NFC payment failed'
      };
    }
  }

  /**
   * Process hardware device payment (Android only)
   */
  private async processHardwarePayment(request: PaymentRequest): Promise<PaymentResult> {
    try {
      // TODO: Implement SumUp hardware device payment
      // const SumUpSDK = require('@sumup/react-native-sumup-sdk');
      // const result = await SumUpSDK.checkoutWithDevice({
      //   total: request.amount,
      //   currency: request.currency,
      //   title: request.description
      // });

      // For now, simulate the payment process
      await new Promise(resolve => setTimeout(resolve, 3000));

      return {
        success: true,
        transactionId: `hw_${Date.now()}`,
        method: 'sumup_hardware',
        amount: request.amount,
        timestamp: Date.now(),
        receiptData: {
          cardType: 'Mastercard',
          lastFour: '****5678',
          authCode: 'AUTH456'
        }
      };
    } catch (error: any) {
      return {
        success: false,
        method: 'sumup_hardware',
        amount: request.amount,
        timestamp: Date.now(),
        error: error.message || 'Hardware payment failed'
      };
    }
  }

  /**
   * Check if NFC is available on device
   */
  private async checkNFCAvailability(): Promise<boolean> {
    try {
      // TODO: Implement NFC availability check
      // const NfcManager = require('react-native-nfc-manager');
      // const supported = await NfcManager.isSupported();
      // const enabled = await NfcManager.isEnabled();
      // return supported && enabled;

      // For now, assume NFC is available on most modern devices
      return Platform.OS === 'ios' || Platform.OS === 'android';
    } catch (error) {
      console.error('NFC availability check failed:', error);
      return false;
    }
  }

  /**
   * Check if SumUp hardware device is connected
   */
  private async checkHardwareDevice(): Promise<boolean> {
    try {
      // TODO: Implement hardware device check
      // const SumUpSDK = require('@sumup/react-native-sumup-sdk');
      // const devices = await SumUpSDK.getConnectedDevices();
      // return devices.length > 0;

      // For now, simulate device availability
      return Platform.OS === 'android';
    } catch (error) {
      console.error('Hardware device check failed:', error);
      return false;
    }
  }

  /**
   * Log successful payment for audit trail
   */
  private async logPaymentSuccess(request: PaymentRequest, result: PaymentResult, method: PaymentMethod): Promise<void> {
    const logEntry = {
      timestamp: result.timestamp,
      transactionId: result.transactionId,
      method: method.name,
      amount: request.amount,
      currency: request.currency,
      playerId: request.playerId,
      playerName: request.playerName,
      assignmentIds: request.assignmentIds,
      success: result.success
    };

    console.log('Payment logged:', logEntry);
    // TODO: Store in Firebase for audit trail
  }

  /**
   * Update payment settings
   */
  updateSettings(newSettings: Partial<PaymentSettings>): void {
    this.settings = { ...this.settings, ...newSettings };
  }

  /**
   * Get current payment settings
   */
  getSettings(): PaymentSettings {
    return { ...this.settings };
  }

  /**
   * Generate receipt data
   */
  generateReceipt(request: PaymentRequest, result: PaymentResult): any {
    return {
      id: result.transactionId,
      timestamp: result.timestamp,
      amount: request.amount,
      currency: request.currency,
      player: request.playerName,
      method: result.method,
      items: request.assignmentIds.length,
      receiptData: result.receiptData
    };
  }
}

// Export singleton instance
export const paymentService = new PaymentService();
export default paymentService;