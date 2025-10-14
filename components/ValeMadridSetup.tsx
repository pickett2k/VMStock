import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Alert } from 'react-native';
import { setupValeMadridOrganization } from '../utils/setupValeMadridOrg';

/**
 * Temporary component to set up Vale Madrid organization
 * Add this to your app temporarily, run it once, then remove it
 */
export const ValeMadridSetup = () => {
  const handleSetup = async () => {
    try {
      await setupValeMadridOrganization();
      Alert.alert(
        'Setup Complete!',
        'Vale Madrid Tuck Shop organization has been set up successfully.\n\nShop PIN: 123456\n\nYou can now remove this setup component from your app.',
        [{ text: 'OK' }]
      );
    } catch (error) {
      Alert.alert(
        'Setup Failed',
        'Failed to set up organization. Check the console for details.',
        [{ text: 'OK' }]
      );
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Vale Madrid Organization Setup</Text>
      <Text style={styles.description}>
        This will set up the Vale Madrid Tuck Shop organization with the new structure including shop PIN.
      </Text>
      <TouchableOpacity style={styles.button} onPress={handleSetup}>
        <Text style={styles.buttonText}>Set Up Organization</Text>
      </TouchableOpacity>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#f0f8ff',
    padding: 20,
    margin: 10,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: '#007bff',
  },
  title: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#007bff',
    marginBottom: 10,
  },
  description: {
    fontSize: 14,
    color: '#333',
    marginBottom: 15,
  },
  button: {
    backgroundColor: '#007bff',
    padding: 12,
    borderRadius: 6,
    alignItems: 'center',
  },
  buttonText: {
    color: '#fff',
    fontWeight: 'bold',
    fontSize: 16,
  },
});

export default ValeMadridSetup;