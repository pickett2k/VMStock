declare module '@env' {
  export const FIREBASE_API_KEY: string;
  export const FIREBASE_AUTH_DOMAIN: string;
  export const FIREBASE_PROJECT_ID: string;
  export const FIREBASE_STORAGE_BUCKET: string;
  export const FIREBASE_MESSAGING_SENDER_ID: string;
  export const FIREBASE_APP_ID: string;
  export const FIREBASE_MEASUREMENT_ID: string;
  
  export const EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY: string;
  export const CLERK_SECRET_KEY: string;
  
  export const APP_ENV: string;
  export const APP_NAME: string;
  export const APP_VERSION: string;
  
  export const DEFAULT_ORGANIZATION_NAME: string;
  export const DEFAULT_CURRENCY: string;
  export const DEFAULT_TIMEZONE: string;
  
  export const DEV_MODE: string;
  export const DEBUG_FIREBASE: string;
  export const DEBUG_AUTH: string;
  export const ENABLE_FLIPPER: string;
  
  export const ENABLE_ANALYTICS: string;
  export const ENABLE_CRASHLYTICS: string;
  export const SENTRY_DSN: string;
  export const MIXPANEL_TOKEN: string;
  
  export const FCM_SERVER_KEY: string;
  export const FCM_SENDER_ID: string;
  export const ENABLE_PUSH_NOTIFICATIONS: string;
  export const DEFAULT_NOTIFICATION_SOUND: string;
  
  export const LOCAL_ENCRYPTION_KEY: string;
  export const JWT_SECRET: string;
  export const API_RATE_LIMIT_PER_MINUTE: string;
  export const MAX_CONCURRENT_REQUESTS: string;
  
  export const ENABLE_BIOMETRIC_AUTH: string;
  export const ENABLE_OFFLINE_MODE: string;
  export const ENABLE_MULTI_ORGANIZATION: string;
  export const ENABLE_BARCODE_SCANNING: string;
  export const ENABLE_EXPORT_FEATURES: string;
  export const ENABLE_ADVANCED_REPORTING: string;
  
  export const TEST_USER_EMAIL: string;
  export const TEST_USER_PASSWORD: string;
  export const TEST_ORGANIZATION_ID: string;
  export const USE_MOCK_DATA: string;
  export const MOCK_NETWORK_DELAY: string;
  
  export const EAS_PROJECT_ID: string;
  export const APPLE_TEAM_ID: string;
  export const GOOGLE_PLAY_SERVICE_ACCOUNT: string;
  export const IOS_BUNDLE_IDENTIFIER: string;
  export const ANDROID_PACKAGE_NAME: string;
  
  export const FIRESTORE_REGION: string;
  export const ENABLE_FIRESTORE_OFFLINE: string;
  export const FIRESTORE_CACHE_SIZE_MB: string;
  export const AUTO_BACKUP_ENABLED: string;
  export const BACKUP_FREQUENCY_HOURS: string;
  export const SYNC_RETRY_ATTEMPTS: string;
  export const SYNC_TIMEOUT_SECONDS: string;
  
  export const DEFAULT_THEME: string;
  export const ENABLE_SYSTEM_THEME: string;
  export const ENABLE_DARK_MODE: string;
  export const ENABLE_HERMES: string;
  export const ENABLE_NEW_ARCHITECTURE: string;
  export const LAZY_LOADING_ENABLED: string;
  
  export const LOG_LEVEL: string;
  export const ENABLE_FILE_LOGGING: string;
  export const MAX_LOG_FILE_SIZE_MB: string;
  export const LOG_RETENTION_DAYS: string;
  export const ENABLE_REMOTE_LOGGING: string;
  export const LOG_ENDPOINT: string;
}