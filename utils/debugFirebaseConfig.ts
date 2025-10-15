// Firebase Configuration Debug Script
// Run this to verify Firebase configuration in production builds

import { 
  FIREBASE_API_KEY,
  FIREBASE_AUTH_DOMAIN,
  FIREBASE_PROJECT_ID,
  FIREBASE_STORAGE_BUCKET,
  FIREBASE_MESSAGING_SENDER_ID,
  FIREBASE_APP_ID,
  FIREBASE_MEASUREMENT_ID,
} from '@env';

console.log('🔍 Firebase Configuration Debug:');
console.log('================================');
console.log('API_KEY (first 20 chars):', FIREBASE_API_KEY?.substring(0, 20) + '...');
console.log('AUTH_DOMAIN:', FIREBASE_AUTH_DOMAIN);
console.log('PROJECT_ID:', FIREBASE_PROJECT_ID);
console.log('STORAGE_BUCKET:', FIREBASE_STORAGE_BUCKET);
console.log('MESSAGING_SENDER_ID:', FIREBASE_MESSAGING_SENDER_ID);
console.log('APP_ID:', FIREBASE_APP_ID);
console.log('MEASUREMENT_ID:', FIREBASE_MEASUREMENT_ID);
console.log('================================');

// Validate each field
const issues = [];

if (!FIREBASE_API_KEY || FIREBASE_API_KEY.length < 30) {
  issues.push('FIREBASE_API_KEY appears invalid or missing');
}

if (!FIREBASE_AUTH_DOMAIN || !FIREBASE_AUTH_DOMAIN.includes('.firebaseapp.com')) {
  issues.push('FIREBASE_AUTH_DOMAIN appears invalid or missing');
}

if (!FIREBASE_PROJECT_ID || FIREBASE_PROJECT_ID.length < 5) {
  issues.push('FIREBASE_PROJECT_ID appears invalid or missing');
}

if (!FIREBASE_APP_ID || !FIREBASE_APP_ID.includes(':web:')) {
  issues.push('FIREBASE_APP_ID appears invalid or missing - should contain :web:');
}

if (issues.length > 0) {
  console.error('🚨 Firebase Configuration Issues Found:');
  issues.forEach(issue => console.error('  -', issue));
} else {
  console.log('✅ Firebase configuration appears valid');
}

export default function debugFirebaseConfig() {
  // This function can be called from your app to debug Firebase config
}