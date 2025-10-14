# 🚀 VMStock - Enterprise Offline-First Point of Sale

**Advanced React Native POS system with enterprise-grade offline-first architecture**

## 🏆 Key Features

- **⚡ Instant UI Response** - All operations work instantly, even offline
- **🔄 Delta-Based Sync** - Efficient idempotent ledger operations
- **🏠 Local-First** - Truth stored locally, server hydrates in background
- **💰 Player Balance Management** - Real-time debt/credit tracking
- **📦 Product Inventory** - Stock management with conflict resolution
- **📋 Assignment System** - Sales transactions with payment status
- **🔀 Smart Conflict Resolution** - Automatic merging with timestamp + vector clocks
- **📱 Multi-Device Support** - Seamless sync across devices

## 📚 Architecture Documentation

**👉 [Complete Architecture Guide](./OFFLINE_FIRST_ARCHITECTURE.md)**

This app implements the same offline-first patterns used by Linear, Notion, and Figma:
- Single `applyOp()` function for all writes
- Local cache as source of truth
- Background server hydration
- Vector clock-based conflict resolution
- Enterprise outbox pattern with idempotent transactions

## 🛠️ Tech Stack

- **Frontend**: React Native + Expo
- **Backend**: Firebase Firestore
- **Offline**: AsyncStorage + HybridSyncService
- **Payments**: Stripe + SumUp integration
- **Architecture**: CQRS + Event Sourcing + Offline-First

## Get started

1. Install dependencies

   ```bash
   npm install
   ```

2. Start the app

   ```bash
    npx expo start
   ```

In the output, you'll find options to open the app in a

- [development build](https://docs.expo.dev/develop/development-builds/introduction/)
- [Android emulator](https://docs.expo.dev/workflow/android-studio-emulator/)
- [iOS simulator](https://docs.expo.dev/workflow/ios-simulator/)
- [Expo Go](https://expo.dev/go), a limited sandbox for trying out app development with Expo

You can start developing by editing the files inside the **app** directory. This project uses [file-based routing](https://docs.expo.dev/router/introduction).

## Get a fresh project

When you're ready, run:

```bash
npm run reset-project
```

This command will move the starter code to the **app-example** directory and create a blank **app** directory where you can start developing.

## Learn more

To learn more about developing your project with Expo, look at the following resources:

- [Expo documentation](https://docs.expo.dev/): Learn fundamentals, or go into advanced topics with our [guides](https://docs.expo.dev/guides).
- [Learn Expo tutorial](https://docs.expo.dev/tutorial/introduction/): Follow a step-by-step tutorial where you'll create a project that runs on Android, iOS, and the web.

## Join the community

Join our community of developers creating universal apps.

- [Expo on GitHub](https://github.com/expo/expo): View our open source platform and contribute.
- [Discord community](https://chat.expo.dev): Chat with Expo users and ask questions.
