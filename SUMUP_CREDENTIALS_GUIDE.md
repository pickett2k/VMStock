# Finding Your SumUp Credentials - Complete Guide

## 🎯 What You Need vs What SumUp Calls It

Based on your `.env` file, you need to find these credentials in the SumUp Developer Portal:

```bash
# What you have:
SUMUP_APP_SECRET=sup_sk_JospkeSNMkNxksawrPHh3JR8ONrLq3otT ✅ (You have this!)

# What you still need:
SUMUP_APP_ID=your_app_id_here
SUMUP_MERCHANT_CODE=your_merchant_code_here  
SUMUP_API_KEY=your_api_key_here
```

## 🔍 Step-by-Step: Finding SumUp Credentials

### 1. Login to SumUp Developer Portal
- Go to: [https://developer.sumup.com/](https://developer.sumup.com/)
- Login with your SumUp merchant account

### 2. Find/Create Your Application

**Option A: If you already created an app:**
- Go to "My Apps" or "Applications" section
- Click on your app name

**Option B: If you need to create an app:**
- Click "Create New Application" or "Register Application"
- Fill in:
  - **App Name**: `VMStock POS System`
  - **Description**: `Point of sale system for stock management`
  - **Redirect URI**: `vmstock://sumup-callback`
  - **Scopes**: Select `payments`, `transactions.history`, `user.app-settings`

### 3. Locate Your Credentials

Once in your app dashboard, look for these sections:

#### **SUMUP_APP_ID** (Also called: Client ID, Application ID)
- **Look for**: "Client ID", "App ID", or "Application ID"
- **Format**: Usually looks like `com.yourapp.name` or a UUID
- **Location**: Usually on the app overview/dashboard page

#### **SUMUP_MERCHANT_CODE** (Also called: Merchant Account, Merchant ID)
- **Look for**: "Merchant Code", "Merchant ID", or "Account Code"  
- **Format**: Usually 3-8 characters (like `ABC123` or `MERCHANT1`)
- **Location**: May be in "Account Settings" or "Merchant Settings"
- **Alternative**: Check your physical SumUp device or email from SumUp setup

#### **SUMUP_API_KEY** (Different from APP_SECRET)
- **Look for**: "API Key", "Access Token", or "Public Key"
- **Format**: Different from your `sup_sk_` secret key
- **Location**: Usually in "API Keys" or "Authentication" section

## 🔍 Alternative Locations to Check

### If you can't find credentials in Developer Portal:

#### **Merchant Code Options:**
1. **Physical SumUp Device**: Often printed on device or packaging
2. **SumUp Mobile App**: Go to Settings → Account → Merchant Information
3. **Email Confirmation**: Check setup emails from SumUp
4. **SumUp Dashboard**: [https://me.sumup.com/](https://me.sumup.com/) → Settings

#### **API Credentials:**
1. **Apps Section**: Look for "Manage Apps" or "Integrations"
2. **Developer Tools**: May be under "Tools" or "API Access"
3. **Account Settings**: Sometimes under main account settings

## 📧 What to Do If You Can't Find Them

### Contact SumUp Support:
- **Developer Support**: [developer@sumup.com](mailto:developer@sumup.com)
- **Tell them**: "I need my API credentials for React Native SDK integration"
- **Provide**: Your merchant account email and business name

### What to Ask For:
```
Hi SumUp Support,

I'm integrating the SumUp SDK into my React Native POS app called "VMStock" 
and need the following credentials:

1. Application ID (Client ID) for my registered app
2. Merchant Code for my merchant account  
3. API Key for transaction processing

My merchant account email is: [your_email]
My business name is: [your_business_name]

Thank you!
```

## 🧪 Testing Configuration

### Once you have the credentials:

#### **Update your .env file:**
```bash
SUMUP_ENABLED=true  # Change to true to enable
SUMUP_APP_ID=your_actual_app_id
SUMUP_APP_SECRET=sup_sk_JospkeSNMkNxksawrPHh3JR8ONrLq3otT  # You have this ✅
SUMUP_MERCHANT_CODE=your_actual_merchant_code
SUMUP_API_KEY=your_actual_api_key
SUMUP_ENVIRONMENT=sandbox  # Keep as sandbox for testing
```

#### **Test the integration:**
1. Set `SUMUP_ENABLED=true` in your .env
2. Uncomment the PaymentService code
3. Test with sandbox/test transactions first
4. Switch to `production` environment when ready

## 🚨 Common Issues & Solutions

### **Issue**: "Application not found"
- **Solution**: Make sure you created the app in the developer portal
- **Check**: App name matches exactly

### **Issue**: "Invalid merchant code"  
- **Solution**: Try looking in SumUp mobile app settings
- **Alternative**: Use your SumUp login email as merchant identifier

### **Issue**: "Authentication failed"
- **Solution**: Double-check the API secret format (should start with `sup_sk_`)
- **Check**: No extra spaces or characters copied

### **Issue**: "Cannot find developer portal"
- **Solution**: Some regions use different URLs:
  - **EU**: [https://developer.sumup.com/](https://developer.sumup.com/)
  - **US**: [https://developer.sumup.us/](https://developer.sumup.us/)
  - **UK**: [https://developer.sumup.co.uk/](https://developer.sumup.co.uk/)

## 📱 Quick Test

Once you have all credentials, you can test the connection:

```typescript
// Test in your app or create a simple test file
import { paymentService } from './services/PaymentService';

const testConnection = async () => {
  try {
    const initialized = await paymentService.initializeSumUp();
    console.log('SumUp initialization:', initialized ? '✅ SUCCESS' : '❌ FAILED');
  } catch (error) {
    console.error('Connection test failed:', error);
  }
};
```

Let me know what you find in the portal and I can help you map the SumUp fields to the correct environment variables! 🚀