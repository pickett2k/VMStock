# Email Verification Troubleshooting Guide

## Issue: Not Receiving Firebase Email Verification

### 1. Check Firebase Console Settings

#### Authentication Templates:
1. Go to [Firebase Console](https://console.firebase.google.com/)
2. Select your project
3. Go to **Authentication** > **Templates**
4. Check **Email address verification** template:
   - Ensure it's **enabled**
   - Customize the email template if needed
   - Set a proper sender name
   - Verify the action URL is correct

#### Authentication Settings:
1. Go to **Authentication** > **Settings**
2. Under **Authorized domains**:
   - Add your domain (e.g., `vmstock.app`)
   - For development, ensure `localhost` is included
3. Check **Email verification** is enabled in **Sign-in method**

### 2. Check Your Email

#### Common Issues:
- **Spam/Junk Folder**: Check spam folder first
- **Email Filters**: Check if you have filters blocking Firebase emails
- **Corporate Email**: Some corporate emails block automated messages
- **Temporary Email Services**: Some services block verification emails

#### Firebase Email Details:
- **From**: Usually `noreply@[your-project].firebaseapp.com`
- **Subject**: "Verify your email for [Your App Name]"
- **Delivery Time**: Usually within 2-3 minutes

### 3. Code Implementation Check

The current implementation includes:
```typescript
// During signup
await sendEmailVerification(userCredential.user, {
  url: 'https://vmstock.app/email-verified',
  handleCodeInApp: true,
});

// Resend functionality
await sendEmailVerification(currentUser, actionCodeSettings);
```

### 4. Testing Steps

#### Test Email Verification:
1. **Check Console Logs**:
   ```
   📧 Attempting to send email verification to: [email]
   ✅ Email verification sent successfully to: [email]
   📧 Check your email (including spam folder) for verification link
   ```

2. **Try Different Email Providers**:
   - Gmail (usually works best)
   - Outlook/Hotmail
   - Yahoo
   - Avoid temporary email services

3. **Test Resend Function**:
   - Use the "Resend Verification" button
   - Check for rate limiting messages

#### Debug Email Issues:
1. **Check Firebase Console Logs**:
   - Go to **Authentication** > **Users**
   - Find your user account
   - Check if `emailVerified` is `false`

2. **Manual Verification (Testing Only)**:
   ```javascript
   // In Firebase Console > Authentication > Users
   // Click on user and manually set emailVerified to true
   ```

### 5. Alternative Solutions

#### If Emails Still Don't Arrive:

1. **Custom Email Provider** (Advanced):
   - Set up custom SMTP in Firebase
   - Use services like SendGrid, Mailgun, or AWS SES

2. **Phone Verification Alternative**:
   - Implement phone verification instead
   - Use Firebase Phone Auth

3. **Admin Verification**:
   - Add admin panel to manually verify users
   - Useful for internal testing

### 6. Firebase Console Email Template Setup

#### Customize Email Template:
1. **Authentication** > **Templates** > **Email address verification**
2. **Edit template**:
   ```
   Subject: Verify your email for VMStock
   
   Hello,
   
   Please verify your email address by clicking the link below:
   %LINK%
   
   If you didn't request this, please ignore this email.
   
   Thanks,
   VMStock Team
   ```

#### Template Variables:
- `%LINK%` - Verification link
- `%EMAIL%` - User's email
- `%DISPLAY_NAME%` - User's display name

### 7. Development vs Production

#### Development (Expo/Local):
- Firebase emails work the same
- Check your development environment logs
- Use real email addresses (not temporary)

#### Production:
- Ensure custom domain is properly configured
- Set up proper action URLs
- Configure email templates with your branding

### 8. Quick Fix Checklist

- [ ] Check spam/junk folder
- [ ] Try different email address (Gmail recommended)
- [ ] Check Firebase Console email templates are enabled
- [ ] Verify authorized domains include your domain
- [ ] Check console logs for error messages
- [ ] Try resend verification button
- [ ] Wait 5-10 minutes (sometimes delayed)
- [ ] Check Firebase Console user list for verification status

### 9. If All Else Fails

#### Contact Firebase Support:
- Check Firebase status page
- Post in Firebase Community forums
- For paid plans: Contact Firebase support directly

#### Temporary Workaround:
For testing, you can temporarily disable email verification enforcement:
```typescript
// TEMPORARY - Remove for production
if (!isEmailVerified && !DEV_MODE) {
  return <EmailVerificationBanner />;
}
```

---

**Most Common Solution**: Check your spam folder! 90% of "missing" verification emails are in spam.