# Firebase Console Setup Guide

## 🔥 Step-by-Step Firebase Project Creation

### **Step 1: Create Firebase Project**
1. Go to [Firebase Console](https://console.firebase.google.com/)
2. Click **"Add project"**
3. **Project name**: `VMStock-Production` (or your preferred name)
4. **Enable Google Analytics**: Yes ✅
5. **Analytics account**: Create new or use existing
6. Click **"Create project"**

### **Step 2: Enable Authentication**
1. In Firebase Console → **Authentication**
2. Click **"Get started"**
3. Go to **"Sign-in method"** tab
4. Enable these providers:
   - ✅ **Email/Password** (Enable)
   - ✅ **Phone** (Enable - for users without email)
   - ✅ **Anonymous** (Optional - for guest access)

### **Step 3: Create Firestore Database**
1. Go to **Firestore Database**
2. Click **"Create database"**
3. **Security rules**: Start in **production mode** ✅
4. **Location**: Choose closest to your users (e.g., `europe-west2`)
5. Click **"Enable"**

### **Step 4: Enable Analytics & Crashlytics**
1. Go to **Analytics** → Already enabled ✅
2. Go to **Crashlytics** 
3. Click **"Enable Crashlytics"**

### **Step 5: Add iOS App**
1. Go to **Project Settings** (gear icon)
2. Click **"Add app"** → **iOS**
3. **Bundle ID**: `com.swill85.VMStock` (match your app.json)
4. **App nickname**: `VMStock iOS`
5. Download **`GoogleService-Info.plist`**
6. Save it to: `ios/GoogleService-Info.plist`

### **Step 6: Add Android App**
1. Click **"Add app"** → **Android**
2. **Package name**: `com.swill85.VMStock` (match your app.json)
3. **App nickname**: `VMStock Android`
4. Download **`google-services.json`**
5. Save it to: `android/app/google-services.json`

### **Step 7: Get Configuration Keys**
1. Go to **Project Settings** → **General**
2. Scroll to **"Your apps"**
3. Click on **Web app** → **Config**
4. Copy these values to your `.env` file:

```bash
FIREBASE_API_KEY=your_api_key_here
FIREBASE_AUTH_DOMAIN=your_project_id.firebaseapp.com
FIREBASE_PROJECT_ID=your_project_id_here
FIREBASE_STORAGE_BUCKET=your_project_id.appspot.com
FIREBASE_MESSAGING_SENDER_ID=your_sender_id_here
FIREBASE_APP_ID=your_app_id_here
FIREBASE_MEASUREMENT_ID=G-XXXXXXXXXX
```

## 🔧 Configuration Files Needed

### **Files to Download & Place:**
- `GoogleService-Info.plist` → `ios/` folder
- `google-services.json` → `android/app/` folder

### **Environment File:**
Create `.env` file in root directory with your Firebase config values.

## ✅ Verification Checklist
- [ ] Firebase project created
- [ ] Authentication enabled (Email/Password + Phone)
- [ ] Firestore database created in production mode
- [ ] iOS app registered & plist downloaded
- [ ] Android app registered & json downloaded
- [ ] Configuration keys copied to .env file
- [ ] Analytics & Crashlytics enabled

## 🚀 Next Steps
Once completed, you'll be ready for:
1. Installing Firebase SDKs
2. Implementing authentication
3. Setting up Firestore collections