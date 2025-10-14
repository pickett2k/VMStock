// Script to manually verify a user's email in Firebase Auth
const admin = require('firebase-admin');

// Initialize Firebase Admin (you'll need to set up service account)
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.applicationDefault()
    // Or use a service account key file:
    // credential: admin.credential.cert(require('./path-to-service-account.json'))
  });
}

async function verifyUserEmail(email) {
  try {
    console.log(`🔍 Looking for user with email: ${email}`);
    
    // Get user by email
    const userRecord = await admin.auth().getUserByEmail(email);
    console.log(`📧 Found user: ${userRecord.uid}`);
    
    // Update user to set emailVerified to true
    await admin.auth().updateUser(userRecord.uid, {
      emailVerified: true
    });
    
    console.log(`✅ Email verified for user: ${email}`);
    console.log(`🎉 User ${userRecord.uid} can now access the app without email verification!`);
    
  } catch (error) {
    console.error('❌ Error verifying email:', error);
  }
}

// Replace with your admin email
const ADMIN_EMAIL = 'your-admin-email@example.com';

verifyUserEmail(ADMIN_EMAIL)
  .then(() => {
    console.log('Script completed');
    process.exit(0);
  })
  .catch((error) => {
    console.error('Script failed:', error);
    process.exit(1);
  });