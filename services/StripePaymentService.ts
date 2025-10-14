/**
 * Stripe Payment Service
 * Handles Stripe Terminal and Tap to Pay integration
 */

import { Platform } from 'react-native';

// Conditionally import Stripe only on native platforms
let stripeModule: any = null;
let stripeTerminal: any = null;
if (Platform.OS !== 'web') {
  try {
    stripeModule = require('@stripe/stripe-react-native');
    stripeTerminal = require('@stripe/stripe-terminal-react-native');
  } catch (error) {
    console.warn('Stripe React Native not available:', error);
  }
}

export interface StripePaymentResult {
  success: boolean;
  paymentIntentId?: string;
  amount?: number;
  currency?: string;
  paymentMethod?: string;
  receiptUrl?: string;
  error?: string;
  metadata?: Record<string, any>;
}

export interface StripePaymentRequest {
  amount: number; // in cents (e.g., 750 for £7.50)
  currency: string;
  description?: string;
  receiptEmail?: string;
  metadata?: Record<string, any>;
}

class StripePaymentService {
  private isInitialized = false;
  private terminalInitialized = false;
  private publishableKey: string | null = null;
  private secretKey: string | null = null;
  private locationId: string | null = null;

  constructor() {
    this.loadConfiguration();
  }

  private loadConfiguration() {
    // Load from environment variables - EAS Build will inject these
    this.publishableKey = process.env.STRIPE_PUBLISHABLE_KEY || 'pk_test_51SEvQ0CXcZMAg28gL0ozdsAwaOck6g98qYeFVL2GCPazN2FQbiRcoj7F1g4aPNlS8acXrFXGzqoJfMBbXMDHotnY00eTltc8or';
    this.secretKey = process.env.STRIPE_SECRET_KEY || null; // Will be null for client-side, server handles this
    this.locationId = process.env.STRIPE_TERMINAL_LOCATION_ID || 'tml_test_location';
    
    console.log('🔧 Stripe Configuration Loaded:');
    console.log('📝 Publishable Key:', this.publishableKey ? `${this.publishableKey.substring(0, 12)}...` : 'Not set');
    console.log('📍 Location ID:', this.locationId);
    console.log('🧪 Using Test Environment:', this.publishableKey?.includes('test') ? 'YES' : 'NO');
  }

  /**
   * Initialize Stripe SDK
   */
  async initialize(): Promise<boolean> {
    try {
      if (!this.publishableKey) {
        throw new Error('Stripe publishable key not configured');
      }

      console.log('🔧 Initializing Stripe SDK...');
      
      if (Platform.OS === 'web') {
        console.log('📱 Web platform detected - Stripe Terminal not available');
        return false;
      }

      if (!stripeModule || !stripeModule.initStripe) {
        throw new Error('Stripe React Native module not available on this platform');
      }
      
      await stripeModule.initStripe({
        publishableKey: this.publishableKey,
        merchantIdentifier: 'merchant.com.vmstock.app', // Replace with your merchant ID
        urlScheme: 'vmstock', // Must match app.json scheme
        setReturnUrlSchemeOnAndroid: true,
      });

      console.log('✅ Stripe React Native SDK initialized');
      
      // Note: Terminal initialization would be done separately for NFC payments
      await new Promise(resolve => setTimeout(resolve, 500));
      
      this.isInitialized = true;
      console.log('✅ Stripe SDK initialized successfully');
      
      return true;
    } catch (error) {
      console.error('❌ Stripe initialization failed:', error);
      throw error;
    }
  }

  /**
   * Create Payment Intent using Stripe API
   */
  private async createPaymentIntent(request: StripePaymentRequest): Promise<any> {
    try {
      if (!this.secretKey) {
        throw new Error('Stripe secret key not configured');
      }

      console.log('🔄 Creating real Payment Intent via Stripe API...');
      
      // Create Payment Intent using Stripe API
      const response = await fetch('https://api.stripe.com/v1/payment_intents', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.secretKey}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          amount: request.amount.toString(),
          currency: request.currency.toLowerCase(),
          description: request.description || 'VMStock Payment',
          'automatic_payment_methods[enabled]': 'true',
          'automatic_payment_methods[allow_redirects]': 'never',
          'metadata[source]': 'vmstock_app',
          ...(request.metadata && Object.fromEntries(
            Object.entries(request.metadata).map(([k, v]) => [`metadata[${k}]`, String(v)])
          )),
        }).toString(),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(`Stripe API Error: ${errorData.error?.message || 'Unknown error'}`);
      }

      const paymentIntent = await response.json();
      console.log('✅ Real Payment Intent created:', paymentIntent.id);
      return paymentIntent;
      
    } catch (error) {
      console.error('❌ Failed to create Payment Intent:', error);
      throw error;
    }
  }

  /**
   * Get Terminal connection token for connecting to Stripe Terminal
   */
  private async getConnectionToken(): Promise<string> {
    try {
      if (!this.secretKey) {
        throw new Error('Stripe secret key not configured');
      }

      console.log('🔄 Creating Terminal connection token...');
      
      const response = await fetch('https://api.stripe.com/v1/terminal/connection_tokens', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.secretKey}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          ...(this.locationId && { location: this.locationId }),
        }).toString(),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(`Terminal Connection Token Error: ${errorData.error?.message || 'Unknown error'}`);
      }

      const { secret } = await response.json();
      console.log('✅ Terminal connection token created');
      return secret;
      
    } catch (error) {
      console.error('❌ Failed to create connection token:', error);
      throw error;
    }
  }

  /**
   * Process Tap to Pay payment (NFC)
   */
  async processTapToPay(request: StripePaymentRequest): Promise<StripePaymentResult> {
    try {
      if (Platform.OS === 'web') {
        console.log('📱 Tap to Pay not available on web');
        return { success: false, error: 'Tap to Pay is only available on mobile devices' };
      }

      if (!this.isInitialized) {
        throw new Error('Stripe not initialized. Call initialize() first.');
      }

      console.log(`💳 Processing Tap to Pay: ${request.currency}${(request.amount / 100).toFixed(2)}`);

      // Create Payment Intent
      const paymentIntent = await this.createPaymentIntent(request);

      if (!stripeTerminal) {
        throw new Error('Stripe Terminal SDK not available');
      }

      // Initialize Terminal if not already done
      if (!this.terminalInitialized) {
        await stripeTerminal.initialize({
          fetchConnectionToken: async () => {
            return await this.getConnectionToken();
          }
        });
        this.terminalInitialized = true;
      }

      // For Tap to Pay, we use the device's built-in NFC
      // Discover readers (this will find the device's NFC capability)
      const { readers } = await stripeTerminal.discoverReaders({
        discoveryMethod: stripeTerminal.DiscoveryMethod.TapToPay,
        simulated: __DEV__, // Use simulated readers in development
      });

      if (readers.length === 0) {
        throw new Error('No Tap to Pay capable device found. Please ensure NFC is enabled.');
      }

      // Connect to the reader (device NFC)
      const connectedReader = await stripeTerminal.connectReader(readers[0]);
      console.log('Connected to reader:', connectedReader.reader.label);

      // Collect payment method - this will prompt user to tap card/phone
      const { paymentIntent: collectedIntent } = await stripeTerminal.collectPaymentMethod({
        paymentIntentId: paymentIntent.id,
      });

      // Confirm payment
      const { paymentIntent: confirmedIntent } = await stripeTerminal.processPayment(collectedIntent);

      const result: StripePaymentResult = {
        success: true,
        paymentIntentId: confirmedIntent.id,
        amount: request.amount,
        currency: request.currency,
        paymentMethod: 'NFC Tap to Pay',
        receiptUrl: confirmedIntent.charges?.data[0]?.receipt_url || `https://dashboard.stripe.com/payments/${confirmedIntent.id}`,
        metadata: request.metadata
      };

      console.log('✅ Tap to Pay successful:', result.paymentIntentId);
      return result;

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Payment failed';
      console.error('❌ Tap to Pay failed:', errorMessage);
      
      return {
        success: false,
        amount: request.amount,
        currency: request.currency,
        error: errorMessage
      };
    }
  }

  /**
   * Process card reader payment (hardware)
   */
  async processCardReader(request: StripePaymentRequest): Promise<StripePaymentResult> {
    try {
      if (Platform.OS === 'web') {
        console.log('📱 Card Reader not available on web');
        return { success: false, error: 'Card Reader is only available on mobile devices' };
      }

      if (!this.isInitialized) {
        throw new Error('Stripe not initialized. Call initialize() first.');
      }

      console.log(`💳 Processing Card Reader: ${request.currency}${(request.amount / 100).toFixed(2)}`);

      // Create Payment Intent
      const paymentIntent = await this.createPaymentIntent(request);

      // TODO: Uncomment when Stripe Terminal SDK is installed
      /*
      // Discover hardware readers
      const { readers } = await Terminal.discoverReaders({
        discoveryMethod: 'bluetoothScan', // or 'internet' for internet-connected readers
        simulated: __DEV__,
      });

      if (readers.length === 0) {
        throw new Error('No card readers found. Please ensure your reader is powered on and nearby.');
      }

      // Connect to the first available reader
      await Terminal.connectReader(readers[0]);

      // Collect payment method
      const { paymentIntent: collectedIntent } = await Terminal.collectPaymentMethod({
        paymentIntentId: paymentIntent.id,
      });

      // Confirm payment
      const { paymentIntent: confirmedIntent } = await Terminal.confirmPaymentIntent(collectedIntent);
      */

      // Mock hardware reader payment
      await new Promise(resolve => setTimeout(resolve, 4000)); // Simulate card processing

      const result: StripePaymentResult = {
        success: true,
        paymentIntentId: paymentIntent.id,
        amount: request.amount,
        currency: request.currency,
        paymentMethod: 'Card Reader',
        receiptUrl: `https://dashboard.stripe.com/test/payments/${paymentIntent.id}`,
        metadata: request.metadata
      };

      console.log('✅ Card Reader payment successful:', result.paymentIntentId);
      return result;

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Payment failed';
      console.error('❌ Card Reader payment failed:', errorMessage);
      
      return {
        success: false,
        amount: request.amount,
        currency: request.currency,
        error: errorMessage
      };
    }
  }

  /**
   * Process manual card entry payment using Stripe SDK
   */
  async processManualEntry(request: StripePaymentRequest): Promise<StripePaymentResult> {
    try {
      if (!this.isInitialized) {
        throw new Error('Stripe not initialized. Call initialize() first.');
      }

      console.log(`💳 Processing Manual Entry: ${request.currency}${(request.amount / 100).toFixed(2)}`);

      // Create Payment Intent
      const paymentIntent = await this.createPaymentIntent(request);

      // For testing, create a payment method via API and confirm it
      console.log('🔄 Creating payment method with test card via API...');
      
      // Create payment method using Stripe test token (secure approach)
      const pmResponse = await fetch('https://api.stripe.com/v1/payment_methods', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.secretKey}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          'type': 'card',
          'card[token]': 'tok_visa', // Stripe test token for Visa 4242424242424242
          'billing_details[name]': 'Test Customer - VMStock App',
        }).toString(),
      });

      if (!pmResponse.ok) {
        const errorData = await pmResponse.json();
        throw new Error(`Payment method creation failed: ${errorData.error?.message || 'Unknown error'}`);
      }

      const paymentMethod = await pmResponse.json();
      console.log('✅ Payment method created:', paymentMethod.id);

      // Confirm payment intent with payment method
      console.log('🔄 Confirming payment...');
      const confirmResponse = await fetch(`https://api.stripe.com/v1/payment_intents/${paymentIntent.id}/confirm`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.secretKey}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          'payment_method': paymentMethod.id,
        }).toString(),
      });

      if (!confirmResponse.ok) {
        const errorData = await confirmResponse.json();
        throw new Error(`Payment confirmation failed: ${errorData.error?.message || 'Unknown error'}`);
      }

      const confirmedIntent = await confirmResponse.json();
      console.log('✅ Payment confirmed:', confirmedIntent.id);

      const result: StripePaymentResult = {
        success: true,
        paymentIntentId: confirmedIntent.id,
        amount: request.amount,
        currency: request.currency,
        paymentMethod: 'Card (Test: 4242...4242)',
        receiptUrl: `https://dashboard.stripe.com/test/payments/${confirmedIntent.id}`,
        metadata: request.metadata
      };

      console.log('✅ Manual entry successful:', result.paymentIntentId);
      return result;

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Payment failed';
      console.error('❌ Manual entry failed:', errorMessage);
      
      return {
        success: false,
        amount: request.amount,
        currency: request.currency,
        error: errorMessage
      };
    }
  }

  /**
   * Check if device supports Tap to Pay
   */
  async isDeviceCapable(): Promise<boolean> {
    try {
      // Web platform doesn't support Tap to Pay
      if (Platform.OS === 'web') {
        console.log('🌐 Web platform: Tap to Pay not supported');
        return false;
      }

      const StripeTerminal = require('@stripe/stripe-react-native').StripeTerminal;
      
      // TODO: Uncomment when Stripe Terminal SDK is installed
      /*
      const isCapable = await StripeTerminal.isDeviceCapableOfTapToPay();
      return isCapable;
      */

      // Mock device capability check for mobile
      return true; // Assume all mobile devices are capable for testing
    } catch (error) {
      console.error('❌ Device capability check failed:', error);
      return false;
    }
  }

  /**
   * Get initialization status
   */
  getInitializationStatus() {
    return {
      isInitialized: this.isInitialized,
      hasPublishableKey: !!this.publishableKey,
      hasSecretKey: !!this.secretKey,
      hasLocationId: !!this.locationId,
      environment: this.publishableKey?.startsWith('pk_live_') ? 'live' : 'test'
    };
  }
}

// Export singleton instance
export const stripePaymentService = new StripePaymentService();
export default StripePaymentService;