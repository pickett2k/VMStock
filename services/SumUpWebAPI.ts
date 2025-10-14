/**
 * SumUp Web API Integration
 * Alternative to native SDK - works with your existing credentials
 */

const SUMUP_API_BASE = {
  sandbox: 'https://api.sumup.com',
  production: 'https://api.sumup.com'
};

export class SumUpWebAPI {
  private apiKey: string;
  private environment: 'sandbox' | 'production';
  private baseURL: string;

  constructor(apiKey: string, environment: 'sandbox' | 'production' = 'sandbox') {
    this.apiKey = apiKey;
    this.environment = environment;
    this.baseURL = SUMUP_API_BASE[environment];
  }

  /**
   * Create a checkout session (for web/app payments)
   */
  async createCheckout(params: {
    amount: number;
    currency: string;
    checkout_reference: string;
    pay_to_email?: string;
    merchant_code?: string;
    description?: string;
    return_url?: string;
  }) {
    try {
      const response = await fetch(`${this.baseURL}/v0.1/checkouts`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          ...params,
          // Add test mode indicator if in sandbox
          ...(this.environment === 'sandbox' && { test_mode: true })
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(`SumUp API Error: ${error.message || response.statusText}`);
      }

      return await response.json();
    } catch (error) {
      console.error('SumUp Checkout Creation Error:', error);
      throw error;
    }
  }

  /**
   * Process a payment (for your use case with existing credentials)
   */
  async processPayment(params: {
    amount: number;
    currency: string;
    merchant_code: string;
    checkout_reference: string;
    card_token?: string;
    customer_email?: string;
    description?: string;
  }) {
    try {
      // For your test credentials, we'll create a checkout first
      const checkout = await this.createCheckout({
        amount: params.amount,
        currency: params.currency,
        checkout_reference: params.checkout_reference,
        merchant_code: params.merchant_code,
        description: params.description,
        return_url: 'vmstock://sumup-callback'
      });

      console.log('SumUp Checkout Created:', checkout);

      // Return checkout URL for web payment or native processing
      return {
        success: true,
        checkout_id: checkout.id,
        checkout_url: checkout.checkout_url,
        amount: params.amount,
        currency: params.currency,
        reference: params.checkout_reference,
        status: 'pending'
      };
    } catch (error) {
      console.error('SumUp Payment Error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Payment failed',
        amount: params.amount,
        currency: params.currency,
        reference: params.checkout_reference,
        status: 'failed'
      };
    }
  }

  /**
   * Check transaction status
   */
  async getTransaction(transactionId: string) {
    try {
      const response = await fetch(`${this.baseURL}/v0.1/transactions/${transactionId}`, {
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch transaction: ${response.statusText}`);
      }

      return await response.json();
    } catch (error) {
      console.error('SumUp Transaction Fetch Error:', error);
      throw error;
    }
  }

  /**
   * Validate credentials
   */
  async validateCredentials() {
    try {
      // Test API connection with a simple request
      const response = await fetch(`${this.baseURL}/v0.1/me`, {
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error('Invalid credentials or API access');
      }

      const profile = await response.json();
      return {
        valid: true,
        profile,
        environment: this.environment
      };
    } catch (error) {
      return {
        valid: false,
        error: error instanceof Error ? error.message : 'Validation failed',
        environment: this.environment
      };
    }
  }
}

// Usage example with your credentials
export const createSumUpAPI = () => {
  // Use your API key from .env
  const apiKey = 'cc_sk_classic_nRbBYGqYXG3l0FlGc8QiajgPVgZUXnPSed8VlfXZPHtnmdx1Ch';
  const environment = process.env.SUMUP_ENVIRONMENT === 'production' ? 'production' : 'sandbox';
  
  return new SumUpWebAPI(apiKey, environment);
};

export default SumUpWebAPI;