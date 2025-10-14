/**
 * Email utility functions for normalization and validation
 */

/**
 * Normalize email address by:
 * - Converting to lowercase
 * - Trimming whitespace
 * - Removing dots from Gmail addresses (gmail ignores dots)
 * - Removing + aliases (everything after + sign)
 * - Handling common domain variations
 */
export const normalizeEmail = (email: string): string => {
  if (!email) return '';
  
  // Basic cleanup
  let normalized = email.toLowerCase().trim();
  
  // Split email into local and domain parts
  const [localPart, domain] = normalized.split('@');
  if (!localPart || !domain) return normalized;
  
  let cleanLocal = localPart;
  let cleanDomain = domain;
  
  // Handle Gmail-specific normalization
  if (isGmailDomain(domain)) {
    // Remove dots from Gmail local part (Gmail ignores them)
    cleanLocal = localPart.replace(/\./g, '');
    
    // Remove + aliases (everything after +)
    const plusIndex = cleanLocal.indexOf('+');
    if (plusIndex !== -1) {
      cleanLocal = cleanLocal.substring(0, plusIndex);
    }
  } else {
    // For non-Gmail, only remove + aliases but keep dots
    const plusIndex = cleanLocal.indexOf('+');
    if (plusIndex !== -1) {
      cleanLocal = cleanLocal.substring(0, plusIndex);
    }
  }
  
  // Normalize common domain variations
  cleanDomain = normalizeDomain(cleanDomain);
  
  return `${cleanLocal}@${cleanDomain}`;
};

/**
 * Check if domain is Gmail or Google Apps
 */
const isGmailDomain = (domain: string): boolean => {
  const gmailDomains = [
    'gmail.com',
    'googlemail.com', // UK Gmail
    'google.com'
  ];
  return gmailDomains.includes(domain.toLowerCase());
};

/**
 * Normalize common domain variations
 */
const normalizeDomain = (domain: string): string => {
  const domainMappings: { [key: string]: string } = {
    // Gmail variations
    'googlemail.com': 'gmail.com',
    
    // Outlook variations
    'hotmail.com': 'outlook.com',
    'live.com': 'outlook.com',
    'msn.com': 'outlook.com',
    
    // Yahoo variations
    'ymail.com': 'yahoo.com',
    'rocketmail.com': 'yahoo.com',
  };
  
  return domainMappings[domain.toLowerCase()] || domain.toLowerCase();
};

/**
 * Enhanced email validation
 */
export const validateEmail = (email: string): { isValid: boolean; error?: string } => {
  if (!email) {
    return { isValid: false, error: 'Email is required' };
  }
  
  const normalizedEmail = normalizeEmail(email);
  
  // Basic email regex
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(normalizedEmail)) {
    return { isValid: false, error: 'Please enter a valid email address' };
  }
  
  // Check for common typos in domains
  const commonTypos = detectCommonTypos(normalizedEmail);
  if (commonTypos.hasSuggestion) {
    return { 
      isValid: false, 
      error: `Did you mean ${commonTypos.suggestion}?` 
    };
  }
  
  // Additional checks
  if (normalizedEmail.length > 254) {
    return { isValid: false, error: 'Email address is too long' };
  }
  
  const [localPart, domain] = normalizedEmail.split('@');
  if (localPart.length > 64) {
    return { isValid: false, error: 'Email address is too long' };
  }
  
  // Check for disposable email domains (optional)
  if (isDisposableEmail(domain)) {
    return { isValid: false, error: 'Please use a permanent email address' };
  }
  
  return { isValid: true };
};

/**
 * Detect common email typos and suggest corrections
 */
const detectCommonTypos = (email: string): { hasSuggestion: boolean; suggestion?: string } => {
  const [localPart, domain] = email.split('@');
  
  const commonTypos: { [key: string]: string } = {
    // Gmail typos
    'gmai.com': 'gmail.com',
    'gmial.com': 'gmail.com',
    'gmaill.com': 'gmail.com',
    'gamil.com': 'gmail.com',
    
    // Outlook typos
    'outloo.com': 'outlook.com',
    'outlok.com': 'outlook.com',
    'hotmial.com': 'outlook.com',
    
    // Yahoo typos
    'yaho.com': 'yahoo.com',
    'yahooo.com': 'yahoo.com',
    'yhoo.com': 'yahoo.com',
  };
  
  const suggestion = commonTypos[domain.toLowerCase()];
  if (suggestion) {
    return {
      hasSuggestion: true,
      suggestion: `${localPart}@${suggestion}`
    };
  }
  
  return { hasSuggestion: false };
};

/**
 * Check if email domain is disposable/temporary
 */
const isDisposableEmail = (domain: string): boolean => {
  const disposableDomains = [
    '10minutemail.com',
    'tempmail.org',
    'guerrillamail.com',
    'mailinator.com',
    'yopmail.com',
    'temp-mail.org',
    '0-mail.com',
    // Add more as needed
  ];
  
  return disposableDomains.includes(domain.toLowerCase());
};

/**
 * Get email provider for better Firebase deliverability
 */
export const getEmailProvider = (email: string): 'gmail' | 'outlook' | 'yahoo' | 'other' => {
  const domain = email.split('@')[1]?.toLowerCase();
  
  if (isGmailDomain(domain)) return 'gmail';
  if (['outlook.com', 'hotmail.com', 'live.com', 'msn.com'].includes(domain)) return 'outlook';
  if (['yahoo.com', 'ymail.com', 'rocketmail.com'].includes(domain)) return 'yahoo';
  
  return 'other';
};