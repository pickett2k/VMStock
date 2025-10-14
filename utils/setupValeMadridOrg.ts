import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Vale Madrid Organization Setup Utility
 * Run this once to set up the existing Vale Madrid organization with the new structure
 */

export const setupValeMadridOrganization = async () => {
  try {
    console.log('🏪 Setting up Vale Madrid Tuck Shop organization...');

    // You can customize these values as needed
    const valeMadridOrganization = {
      id: 'vale-madrid-tuck-shop',
      name: 'Vale Madrid Tuck Shop',
      displayName: 'Vale Madrid Tuck Shop',
      type: 'tuck-shop',
      currency: 'GBP',
      shopPin: '052024', // Change this to your preferred 6-digit PIN
      settings: {
        allowNegativeBalance: true,
        requireParentEmail: false,
        autoSyncInterval: 300000 // 5 minutes
      },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    // Store in AsyncStorage (same storage key the app uses)
    await AsyncStorage.setItem('@organization_data', JSON.stringify(valeMadridOrganization));

    console.log('✅ Vale Madrid organization setup complete!');
    console.log('📋 Organization Details:');
    console.log(`   Name: ${valeMadridOrganization.name}`);
    console.log(`   Currency: ${valeMadridOrganization.currency}`);
    console.log(`   Shop PIN: ${valeMadridOrganization.shopPin}`);
    
    return valeMadridOrganization;
  } catch (error) {
    console.error('❌ Failed to setup Vale Madrid organization:', error);
    throw error;
  }
};

// Auto-run setup function (remove this line if you want to call it manually)
// setupValeMadridOrganization();