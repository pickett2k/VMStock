import { Alert, Platform } from 'react-native';

// Conditional Stripe Terminal import to prevent web bundling issues
let useStripeTerminal: any = null;
if (Platform.OS !== 'web') {
  try {
    const stripeTerminal = require('@stripe/stripe-terminal-react-native');
    useStripeTerminal = stripeTerminal.useStripeTerminal;
  } catch (error) {
    console.warn('⚠️ Stripe Terminal not available on this platform');
  }
}

// Define basic types for Terminal SDK
interface TerminalReader {
  id: string;
  deviceType: string;
  serialNumber: string;
}

interface TerminalPaymentIntent {
  id: string;
  amount: number;
  currency: string;
  status?: string;
}

interface TerminalCart {
  lineItems: TerminalLineItem[];
  tax: number;
  total: number;
  currency: string;
}

interface TerminalLineItem {
  displayName: string;
  quantity: number;
  amount: number;
}

// Environment configuration
const Config = {
  STRIPE_TERMINAL_LOCATION_ID: process.env.STRIPE_TERMINAL_LOCATION_ID || '',
  STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY || '',
  STRIPE_ENVIRONMENT: process.env.STRIPE_ENVIRONMENT || 'test'
};

export interface TerminalPaymentRequest {
  amount: number; // in smallest currency unit (cents)
  currency: string;
  description: string;
  playerId: string;
  playerName: string;
}

export interface TerminalPaymentResult {
  success: boolean;
  paymentIntent?: TerminalPaymentIntent;
  transactionId?: string;
  error?: string;
}

class StripeTerminalService {
  private initialized: boolean = false;
  private currentReader: TerminalReader | null = null;
  private connectionToken: string | null = null;
  private isSupported: boolean = false;

  constructor() {
    this.isSupported = Platform.OS !== 'web' && useStripeTerminal !== null;
    console.log('🏪 StripeTerminalService initialized', { 
      platform: Platform.OS, 
      supported: this.isSupported 
    });
  }

  /**
   * Initialize Stripe Terminal SDK
   * This needs to be called before any other Terminal operations
   */
  async initialize(): Promise<boolean> {
    if (!this.isSupported) {
      console.log('⚠️ Stripe Terminal not supported on this platform');
      return false;
    }

    try {
      console.log('🔧 Initializing Stripe Terminal SDK...');
      
      if (this.initialized) {
        console.log('✅ Stripe Terminal already initialized');
        return true;
      }

      // First, we need to get a connection token from your backend
      const token = await this.fetchConnectionToken();
      if (!token) {
        throw new Error('Failed to fetch connection token');
      }

      this.connectionToken = token;
      this.initialized = true;
      
      console.log('✅ Stripe Terminal SDK initialized successfully');
      return true;
    } catch (error) {
      console.error('❌ Failed to initialize Stripe Terminal:', error);
      return false;
    }
  }

  /**
   * Fetch connection token from your backend
   * In production, this should call your server endpoint
   */
  private async fetchConnectionToken(): Promise<string | null> {
    try {
      // TODO: Replace with your actual backend endpoint
      // For now, we'll use a mock token for development
      console.log('🔄 Fetching connection token from backend...');
      
      // This is a mock - you'll need to implement your backend endpoint
      // that calls Stripe's connection token API
      const response = await fetch('YOUR_BACKEND_URL/connection_tokens', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${Config.STRIPE_SECRET_KEY}`,
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();
      console.log('✅ Connection token received');
      return data.secret;
    } catch (error) {
      console.error('❌ Failed to fetch connection token:', error);
      // For development, return null to indicate we need to set up the backend
      return null;
    }
  }

  /**
   * Discover available readers (including NFC-enabled devices)
   * Uses the correct discovery method for Tap to Pay on Android
   */
  async discoverReaders(): Promise<TerminalReader[]> {
    if (!this.isSupported) {
      console.log('⚠️ Stripe Terminal not supported on this platform');
      return [];
    }

    try {
      console.log('🔍 Discovering available readers...');
      
      if (!this.initialized) {
        throw new Error('Terminal not initialized. Call initialize() first.');
      }

      // For Android Tap to Pay, use the tapToPay discovery method
      if (Platform.OS === 'android') {
        // Note: In actual implementation, you would use:
        // const { discoverReaders } = useStripeTerminal();
        // const { readers } = await discoverReaders({ 
        //   discoveryMethod: 'tapToPay',
        //   simulated: Config.STRIPE_ENVIRONMENT === 'test' 
        // });
        
        // For now, return simulated reader
        const tapToPayReader: TerminalReader = {
          id: 'tap_to_pay_reader',
          deviceType: 'tapToPay', // Updated to match Stripe's naming
          serialNumber: 'ANDROID-TAP-TO-PAY',
        };

        console.log('📱 Found Tap to Pay capable Android device');
        return [tapToPayReader];
      }

      console.log('ℹ️ No compatible readers found for this platform');
      return [];
    } catch (error) {
      console.error('❌ Failed to discover readers:', error);
      return [];
    }
  }

  /**
   * Connect to a specific reader
   */
  async connectReader(reader: TerminalReader): Promise<boolean> {
    try {
      console.log(`🔗 Connecting to reader: ${reader.deviceType}`);
      
      if (!this.initialized) {
        throw new Error('Terminal not initialized');
      }

      // For Tap to Pay on Android, the connection is automatic
      if (reader.deviceType === 'tapToPay' || reader.deviceType === 'tap_to_pay') {
        // Note: In actual implementation, you would use:
        // const { connectReader } = useStripeTerminal();
        // await connectReader({ reader, locationId: Config.STRIPE_TERMINAL_LOCATION_ID });
        
        this.currentReader = reader;
        console.log('✅ Connected to Tap to Pay reader');
        return true;
      }

      // For other reader types, implement specific connection logic
      this.currentReader = reader;
      console.log(`✅ Connected to reader: ${reader.id}`);
      return true;
    } catch (error) {
      console.error('❌ Failed to connect to reader:', error);
      return false;
    }
  }

  /**
   * Process NFC payment
   */
  async processNFCPayment(request: TerminalPaymentRequest): Promise<TerminalPaymentResult> {
    try {
      console.log(`💳 Processing NFC payment for ${request.playerName}: ${request.currency}${(request.amount / 100).toFixed(2)}`);
      
      if (!this.initialized || !this.currentReader) {
        throw new Error('Terminal not initialized or no reader connected');
      }

      // Create cart for the payment
      const lineItem: TerminalLineItem = {
        displayName: request.description,
        quantity: 1,
        amount: request.amount,
      };

      const cart: TerminalCart = {
        lineItems: [lineItem],
        tax: 0,
        total: request.amount,
        currency: request.currency.toLowerCase(),
      };

      // For now, we'll simulate the payment process
      // In a real implementation, this would use the Terminal SDK methods
      console.log('🔄 Creating Terminal Payment Intent...');
      
      // Simulate payment processing
      return new Promise((resolve) => {
        setTimeout(() => {
          // Simulate successful payment
          const mockPaymentIntent: TerminalPaymentIntent = {
            id: `pi_terminal_${Date.now()}`,
            amount: request.amount,
            currency: request.currency.toLowerCase(),
            status: 'succeeded',
          };

          console.log(`✅ NFC payment successful: ${mockPaymentIntent.id}`);
          
          resolve({
            success: true,
            paymentIntent: mockPaymentIntent,
            transactionId: mockPaymentIntent.id,
          });
        }, 2000); // Simulate 2 second processing time
      });
    } catch (error) {
      console.error('❌ NFC payment failed:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred',
      };
    }
  }

  /**
   * Check if NFC is available on the device
   */
  async isNFCAvailable(): Promise<boolean> {
    if (!this.isSupported) {
      console.log('⚠️ Stripe Terminal not supported on this platform');
      return false;
    }

    try {
      if (Platform.OS !== 'android') {
        console.log('ℹ️ NFC payments only supported on Android');
        return false;
      }

      // In a real implementation, you'd check device NFC capability
      // For now, assume Android devices have NFC
      console.log('✅ NFC is available on this device');
      return true;
    } catch (error) {
      console.error('❌ Failed to check NFC availability:', error);
      return false;
    }
  }

  /**
   * Disconnect from current reader
   */
  async disconnect(): Promise<void> {
    try {
      if (this.currentReader) {
        console.log('🔌 Disconnecting from reader...');
        this.currentReader = null;
        console.log('✅ Disconnected from reader');
      }
    } catch (error) {
      console.error('❌ Failed to disconnect from reader:', error);
    }
  }

  /**
   * Get current reader status
   */
  getCurrentReader(): TerminalReader | null {
    return this.currentReader;
  }

  /**
   * Check if terminal is ready for payments
   */
  isReady(): boolean {
    return this.initialized && this.currentReader !== null;
  }
}

// Export singleton instance
export const stripeTerminalService = new StripeTerminalService();