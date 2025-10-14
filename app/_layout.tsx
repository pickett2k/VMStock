import React from 'react';
import { createStackNavigator } from '@react-navigation/stack';
import { Dimensions, TouchableOpacity, View, StyleSheet } from 'react-native';
import { ThemeProvider, useTheme } from './ThemeContext';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';

import HomePage from '../components/HomePage';
import ProductsPage from '../components/ProductsPage';
import UsersPage from '../components/UsersPage';
import AssignmentsPage from '../components/AssignmentsPage';
import UserSummary from '../components/UserSummary';
import StockTake from '../components/StockTake';
import ReportsPage from '../components/ReportsPage';
import SalesPage from '../components/TopSales';

const Stack = createStackNavigator();

const ThemeToggleButton = () => {
  const { toggleTheme, isDarkMode } = useTheme();
  return (
    <TouchableOpacity style={styles.toggleButton} onPress={toggleTheme}>
      <Icon name={isDarkMode ? 'weather-sunny' : 'weather-night'} size={24} color="#ffffff" />
    </TouchableOpacity>
  );
};

const RootLayout = () => {
  const { width } = Dimensions.get('window');
  const isLargeScreen = width > 600; // Adjust for tablets

  return (
    <Stack.Navigator
      initialRouteName="Home"
      screenOptions={{
        headerStyle: {
          backgroundColor: isLargeScreen ? '#003366' : '#003366', // Darker blue header
        },
        headerTintColor: '#ffffff', // Lighter text color for header
        headerTitleStyle: {
          fontSize: isLargeScreen ? 24 : 18, // Larger font for larger screens
          fontWeight: 'bold',
        },
        headerRight: () => <ThemeToggleButton />,
        cardStyle: {
          backgroundColor: isLargeScreen ? '#1a1a1a' : '#1a1a1a', // Darker card background
        },
      }}
    >
      <Stack.Screen name="Home" component={HomePage} options={{ title: 'Vale Madrid - Tuck Shop' }} />
      <Stack.Screen name="Products" component={ProductsPage} options={{ title: 'Manage Products' }} />
      <Stack.Screen name="Users" component={UsersPage} options={{ title: 'Manage Players' }} />
      <Stack.Screen name="Assignments" component={AssignmentsPage} options={{ title: 'Sales' }} />
      <Stack.Screen name="User Summary" component={UserSummary} options={{ title: 'Billing' }} />
      <Stack.Screen name="Stock Take" component={StockTake} options={{ title: 'Stock Take' }} />
      <Stack.Screen name="Reports" component={ReportsPage} options={{ title: 'Reports' }} />
      <Stack.Screen name="Sales" component={SalesPage} options={{ title: 'Sales Report' }} />
    </Stack.Navigator>
  );
};

export default RootLayout;

const styles = StyleSheet.create({
  toggleButton: {
    marginRight: 15,
  },
});
