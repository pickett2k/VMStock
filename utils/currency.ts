/**
 * Currency utility functions for formatting prices based on organization currency
 */

export interface CurrencyConfig {
  symbol: string;
  code: string;
  position: 'before' | 'after';
}

const CURRENCY_CONFIGS: Record<string, CurrencyConfig> = {
  USD: {
    symbol: '$',
    code: 'USD',
    position: 'before',
  },
  GBP: {
    symbol: '£',
    code: 'GBP', 
    position: 'before',
  },
  EUR: {
    symbol: '€',
    code: 'EUR',
    position: 'after',
  },
};

/**
 * Get currency configuration for a given currency code
 */
export const getCurrencyConfig = (currencyCode: string): CurrencyConfig => {
  return CURRENCY_CONFIGS[currencyCode?.toUpperCase()] || CURRENCY_CONFIGS.GBP;
};

/**
 * Format a price with the appropriate currency symbol
 */
export const formatCurrency = (amount: number, currencyCode: string): string => {
  const config = getCurrencyConfig(currencyCode);
  const formattedAmount = amount.toFixed(2);
  
  if (config.position === 'before') {
    return `${config.symbol}${formattedAmount}`;
  } else {
    return `${formattedAmount}${config.symbol}`;
  }
};

/**
 * Get just the currency symbol for a given currency code
 */
export const getCurrencySymbol = (currencyCode: string): string => {
  return getCurrencyConfig(currencyCode).symbol;
};

/**
 * Format a price with currency symbol - shorthand version
 */
export const formatPrice = (price: number, currency: string): string => {
  return formatCurrency(price, currency);
};