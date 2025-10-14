import React, { useState, useEffect } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createStackNavigator } from '@react-navigation/stack';
import { Dimensions, TouchableOpacity, StyleSheet, View, Text, Alert } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import MaterialIcons from 'react-native-vector-icons/MaterialIcons';
import { useTheme } from '../app/ThemeContext';
import { useAuth } from '../contexts/AuthContext';
import { useOrganization } from '../contexts/OrganizationContext';
import { hybridSyncService } from '../services/HybridSyncService';

// Import all our component screens
import HomePage from './HomePage';
import ProductsPage from './ProductsPage';
import { PlayersPage } from './PlayersPage';
import AssignmentsPage from './AssignmentsPage';
import PlayerBills from './PlayerBills';
import PlayerCharges from './PlayerCharges';
import StockTake from './StockTake';
import ReportsPage from './ReportsPage';
import SalesPage from './TopSales';
import SyncDebugPanel from './SyncDebugPanel';
import OrganizationSettings from './OrganizationSettings';
import FirebaseAuthTest from './FirebaseAuthTest';

// Remove Stripe imports to prevent web bundling issues

const Stack = createStackNavigator();

const HeaderControls = () => {
  const { toggleTheme, isDarkMode } = useTheme();
  const [isOnline, setIsOnline] = useState(true);
  const [isSyncing, setIsSyncing] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);
  const [syncStatus, setSyncStatus] = useState<'idle' | 'syncing' | 'success' | 'error'>('idle');

  useEffect(() => {
    const updateStatus = async () => {
      try {
        const status = hybridSyncService.getSyncStatus();
        setIsOnline(status.isOnline);
        setIsSyncing(status.isSyncing);
        
        const pendingBundles = await hybridSyncService.getPendingBundlesCount();
        setPendingCount(pendingBundles);
      } catch (error) {
        console.warn('Failed to get sync status:', error);
      }
    };

    updateStatus();
    const interval = setInterval(updateStatus, 5000); // Update every 5 seconds
    return () => clearInterval(interval);
  }, []);

  const handleManualSync = async () => {
    if (isSyncing || syncStatus === 'syncing') return;
    
    try {
      setIsSyncing(true);
      setSyncStatus('syncing');
      console.log('🚀 Manual sync initiated from header');
      await hybridSyncService.forcSync();
      console.log('✅ Manual sync completed');
      
      // Show success state for 2 seconds
      setSyncStatus('success');
      setTimeout(() => {
        setSyncStatus('idle');
      }, 2000);
    } catch (error) {
      console.error('❌ Manual sync failed:', error);
      setSyncStatus('error');
      Alert.alert(
        'Sync Failed', 
        'Unable to sync data. Please check your connection and try again.',
        [
          {
            text: 'OK',
            onPress: () => {
              setTimeout(() => {
                setSyncStatus('idle');
              }, 500);
            }
          }
        ]
      );
    } finally {
      setIsSyncing(false);
    }
  };

  return (
    <View style={styles.headerControls}>
      {/* Online/Offline Globe Indicator */}
      <TouchableOpacity style={styles.syncControl} disabled={true}>
        <MaterialIcons 
          name={isOnline ? 'public' : 'public-off'} 
          size={20} 
          color={isOnline ? '#4CAF50' : '#FF5722'} 
        />
        {pendingCount > 0 && (
          <View style={styles.syncBadge}>
            <Text style={styles.syncBadgeText}>{pendingCount}</Text>
          </View>
        )}
      </TouchableOpacity>

      {/* Manual Sync Button */}
      <TouchableOpacity 
        style={[styles.syncControl, { opacity: syncStatus === 'syncing' ? 0.6 : 1 }]} 
        onPress={handleManualSync}
        disabled={syncStatus === 'syncing'}
      >
        {syncStatus === 'success' ? (
          <MaterialIcons 
            name="check-circle" 
            size={20} 
            color="#4CAF50"
          />
        ) : syncStatus === 'error' ? (
          <MaterialIcons 
            name="error" 
            size={20} 
            color="#FF5722"
          />
        ) : (
          <MaterialIcons 
            name="sync" 
            size={20} 
            color="#ffffff"
            style={syncStatus === 'syncing' ? styles.spinning : undefined}
          />
        )}
      </TouchableOpacity>

      {/* Theme Toggle */}
      <TouchableOpacity style={styles.toggleButton} onPress={toggleTheme}>
        <Icon name={isDarkMode ? 'weather-sunny' : 'weather-night'} size={20} color="#ffffff" />
      </TouchableOpacity>
    </View>
  );
};

export default function AppNavigator() {
  const { width } = Dimensions.get('window');
  const isLargeScreen = width > 600;
  const { theme } = useTheme();
  const { organization } = useOrganization();
  const { isAdmin, assignedPlayer } = useAuth();

  // REMOVED: Async charge checking - violates offline-first architecture
  // Charges should always be available via provisional overlay system
  // The PlayerCharges component will handle empty state if no charges exist

  return (
    <NavigationContainer>
      <Stack.Navigator
        initialRouteName="Home"
        screenOptions={{
          headerStyle: {
            backgroundColor: theme.colors.primary,
          },
          headerTintColor: '#ffffff',
          headerTitleStyle: {
            fontWeight: 'bold',
            fontSize: isLargeScreen ? 22 : 18,
            marginRight: 120, // Reduced margin - should fit all 3 icons comfortably
          },
          headerRight: () => <HeaderControls />,
        }}
      >
        <Stack.Screen 
          name="Home" 
          component={HomePage} 
          options={{ title: organization?.displayName || 'VM Tuck Shop' }}
        />
        <Stack.Screen 
          name="Products" 
          component={ProductsPage} 
          options={{ title: 'Products Management' }}
        />
        <Stack.Screen 
          name="Users" 
          component={PlayersPage} 
          options={{ title: 'Players Management' }}
        />

        <Stack.Screen 
          name="Assignments" 
          component={AssignmentsPage} 
          options={{ title: 'User Assignments' }}
        />
        <Stack.Screen 
          name="PlayerBills" 
          component={PlayerBills} 
          options={{ title: 'Player Bills' }}
        />
        {/* PlayerCharges screen - always register for offline-first architecture */}
        <Stack.Screen 
          name="PlayerCharges" 
          component={PlayerCharges} 
          options={{ title: 'Player Charges' }}
        />
        <Stack.Screen 
          name="Stock Take" 
          component={StockTake} 
          options={{ title: 'Stock Take' }}
        />
        <Stack.Screen 
          name="Reports" 
          component={ReportsPage} 
          options={{ title: 'Reports' }}
        />
        <Stack.Screen 
          name="Sales" 
          component={SalesPage} 
          options={{ title: 'Top Sales' }}
        />
        <Stack.Screen 
          name="SyncDebug" 
          component={SyncDebugPanel} 
          options={{ title: '🔍 Sync Debug' }}
        />
        <Stack.Screen 
          name="OrganizationSettings" 
          component={OrganizationSettings} 
          options={{ title: '🏢 Organization Settings' }}
        />
        <Stack.Screen 
          name="FirebaseAuthTest" 
          component={FirebaseAuthTest} 
          options={{ title: '🔐 Firebase Auth Test' }}
        />

        {/* Stripe Test Screen removed to prevent web bundling issues */}
      </Stack.Navigator>
    </NavigationContainer>
  );
}

const styles = StyleSheet.create({
  headerControls: {
    flexDirection: 'row',
    alignItems: 'center',
    marginRight: 10,
  },
  syncControl: {
    marginRight: 10,
    padding: 5,
    position: 'relative',
  },
  syncBadge: {
    position: 'absolute',
    top: -2,
    right: -2,
    backgroundColor: '#FF5722',
    borderRadius: 10,
    minWidth: 18,
    height: 18,
    justifyContent: 'center',
    alignItems: 'center',
  },
  syncBadgeText: {
    color: '#fff',
    fontSize: 10,
    fontWeight: 'bold',
  },
  toggleButton: {
    marginRight: 8,
    padding: 5,
  },
  spinning: {
    // Simple rotation style - would need animated library for actual spinning
    transform: [{ rotate: '45deg' }],
  },
});