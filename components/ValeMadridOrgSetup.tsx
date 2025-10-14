import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Alert } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useOrganization } from '../contexts/OrganizationContext';
import { useTheme } from '../app/ThemeContext';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';

// Organization data from setup script
const VALE_MADRID_ORG = {
  id: 'vale-madrid-tuck-shop',
  name: 'Vale Madrid Tuck Shop',
  displayName: 'Vale Madrid Tuck Shop',
  type: 'tuck-shop' as const,
  currency: 'GBP',
  shopPin: '666234',
  settings: {
    autoSyncInterval: 300000, // 5 minutes
    features: {
      enableStripePayments: true,
      enableNFCPayments: true,
      enableSumUpPayments: false
    }
  },
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString()
};

export default function ValeMadridOrgSetup() {
  const { organization, updateOrganization } = useOrganization();
  const { isDarkMode } = useTheme();
  const [hasShopPin, setHasShopPin] = useState(false);

  useEffect(() => {
    // Check if current organization has a shop PIN
    if (organization) {
      setHasShopPin(!!organization.shopPin);
    }
  }, [organization]);

  const handleUpdateOrganization = async () => {
    try {
      await updateOrganization(VALE_MADRID_ORG);
      Alert.alert(
        'Success!', 
        `Organization updated with shop PIN: ${VALE_MADRID_ORG.shopPin}\n\nUsers can now join using this PIN, and you can access Organization Settings from the menu.`
      );
    } catch (error) {
      Alert.alert('Error', 'Failed to update organization settings');
      console.error('Failed to update organization:', error);
    }
  };

  // Don't show if organization already has shop PIN
  if (!organization || hasShopPin) {
    return null;
  }

  return (
    <View style={[styles.container, isDarkMode && styles.darkContainer]}>
      <View style={styles.header}>
        <Icon name="store-cog" size={24} color="#007bff" />
        <Text style={[styles.title, isDarkMode && styles.darkText]}>
          Organization Setup
        </Text>
      </View>
      
      <Text style={[styles.description, isDarkMode && styles.darkText]}>
        Your organization needs updated settings including a shop PIN for sharing.
      </Text>
      
      <TouchableOpacity 
        style={styles.button}
        onPress={handleUpdateOrganization}
      >
        <Icon name="update" size={16} color="#fff" style={styles.buttonIcon} />
        <Text style={styles.buttonText}>Update Organization Settings</Text>
      </TouchableOpacity>
      
      <Text style={[styles.note, isDarkMode && styles.darkSubtext]}>
        This will add sharing features and advanced settings to your organization.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#e3f2fd',
    borderRadius: 8,
    padding: 15,
    margin: 15,
    borderWidth: 1,
    borderColor: '#007bff',
  },
  darkContainer: {
    backgroundColor: '#1a2332',
    borderColor: '#4dabf7',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
  },
  title: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#333',
    marginLeft: 8,
  },
  darkText: {
    color: '#fff',
  },
  description: {
    fontSize: 14,
    color: '#555',
    marginBottom: 15,
    lineHeight: 20,
  },
  button: {
    backgroundColor: '#007bff',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 12,
    borderRadius: 6,
    marginBottom: 10,
  },
  buttonIcon: {
    marginRight: 8,
  },
  buttonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  note: {
    fontSize: 12,
    color: '#666',
    textAlign: 'center',
    fontStyle: 'italic',
  },
  darkSubtext: {
    color: '#ccc',
  },
});