import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Image,
  Modal,
} from 'react-native';
import { CameraView, Camera } from 'expo-camera';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useOrganization } from '../contexts/OrganizationContext';
import { useTheme } from '../app/ThemeContext';

export default function OrganizationSetupScreen() {
  const [mode, setMode] = useState<'choose' | 'create' | 'join' | 'scan'>('choose');
  const [shopName, setShopName] = useState('');
  const [currency, setCurrency] = useState('GBP');
  const [organizationType, setOrganizationType] = useState('tuck-shop');
  const [shopPin, setShopPin] = useState('');
  const [loading, setLoading] = useState(false);
  const [hasPermission, setHasPermission] = useState<boolean | null>(null);
  const [showScanner, setShowScanner] = useState(false);

  const { createOrganization } = useOrganization();
  // TODO: joinOrganizationByPin method needs to be implemented in OrganizationContext
  const { isDarkMode } = useTheme();

  const organizationTypes = [
    { value: 'tuck-shop', label: 'Tuck Shop' },
    { value: 'canteen', label: 'Canteen' },
    { value: 'cafe', label: 'Cafe' },
    { value: 'store', label: 'Store' }
  ];

  const currencies = ['GBP', 'EUR', 'USD'];

  const requestCameraPermission = async () => {
    const { status } = await Camera.requestCameraPermissionsAsync();
    setHasPermission(status === 'granted');
    return status === 'granted';
  };

  const handleBarCodeScanned = ({ type, data }: { type: string; data: string }) => {
    setShowScanner(false);
    try {
      // Try to parse the QR code data as JSON
      const qrData = JSON.parse(data);
      if (qrData.shopPin) {
        handleJoinShopByPin(qrData.shopPin);
      } else {
        Alert.alert('Invalid QR Code', 'This QR code does not contain organization information.');
      }
    } catch (error) {
      // If it's not JSON, treat it as a plain PIN
      if (data.length === 6 && /^\d+$/.test(data)) {
        handleJoinShopByPin(data);
      } else {
        Alert.alert('Invalid QR Code', 'This QR code does not contain a valid organization PIN.');
      }
    }
  };

  const handleCreateShop = async () => {
    if (!shopName.trim()) {
      Alert.alert('Error', 'Please enter your organization name');
      return;
    }

    setLoading(true);
    
    try {
      console.log('🏪 Creating new organization');
      
      await createOrganization({
        name: shopName.trim(),
        displayName: shopName.trim(),
        type: organizationType as 'tuck-shop' | 'canteen' | 'cafe' | 'store',
        currency,
        settings: {
          allowNegativeBalance: true,
          requireParentEmail: false,
          autoSyncInterval: 300000, // 5 minutes
        }
      });

      Alert.alert(
        'Organization Created!', 
        'Your organization has been created successfully. You can set up additional details in Organization Settings.',
        [{ text: 'Get Started' }]
      );
    } catch (error: any) {
      Alert.alert('Error', 'Failed to create organization. Please try again.');
      console.error('Error creating organization:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleJoinShopByPin = async (pin: string) => {
    setLoading(true);
    
    try {
      // TODO: Implement joinOrganizationByPin functionality
      Alert.alert('Not Implemented', 'Join organization by PIN functionality needs to be implemented.');
      console.warn('joinOrganizationByPin not implemented yet');
    } catch (error: any) {
      Alert.alert('Error', 'Failed to join organization. Please check the PIN and try again.');
      console.error('Error joining organization:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleJoinShop = async () => {
    if (!shopPin.trim() || shopPin.length !== 6) {
      Alert.alert('Error', 'Please enter a valid 6-digit organization PIN');
      return;
    }

    await handleJoinShopByPin(shopPin);
  };

  const startQRScanner = async () => {
    const hasPermission = await requestCameraPermission();
    if (hasPermission) {
      setShowScanner(true);
    } else {
      Alert.alert('Permission Required', 'Camera permission is required to scan QR codes.');
    }
  };

  const renderChooseMode = () => (
    <View style={styles.formContainer}>
      <Text style={[styles.formTitle, isDarkMode && styles.darkText]}>
        Setup Your Organization
      </Text>
      <Text style={[styles.subtitle, isDarkMode && styles.darkSubtitle]}>
        Create a new organization or join an existing one
      </Text>

      <TouchableOpacity
        style={[styles.modeButton, styles.createButton]}
        onPress={() => setMode('create')}
      >
        <Icon name="plus-circle" size={24} color="#28a745" />
        <View style={styles.modeButtonContent}>
          <Text style={styles.modeButtonText}>Create New Organization</Text>
          <Text style={styles.modeButtonSubtext}>Start fresh with your own setup</Text>
        </View>
      </TouchableOpacity>

      <TouchableOpacity
        style={[styles.modeButton, styles.joinButton]}
        onPress={() => setMode('join')}
      >
        <Icon name="account-plus" size={24} color="#007bff" />
        <View style={styles.modeButtonContent}>
          <Text style={styles.modeButtonText}>Join Existing Organization</Text>
          <Text style={styles.modeButtonSubtext}>Enter a PIN or scan QR code</Text>
        </View>
      </TouchableOpacity>
    </View>
  );

  const renderCreateMode = () => (
    <View style={styles.formContainer}>
      <TouchableOpacity
        style={styles.backButton}
        onPress={() => setMode('choose')}
      >
        <Icon name="arrow-left" size={20} color={isDarkMode ? '#fff' : '#007bff'} />
        <Text style={[styles.backButtonText, isDarkMode && styles.darkText]}>Back</Text>
      </TouchableOpacity>

      <Text style={[styles.formTitle, isDarkMode && styles.darkText]}>
        Create New Organization
      </Text>

      <View style={styles.inputGroup}>
        <Text style={[styles.inputLabel, isDarkMode && styles.darkText]}>Organization Name</Text>
        <TextInput
          style={[styles.input, isDarkMode && styles.darkInput]}
          value={shopName}
          onChangeText={setShopName}
          placeholder="Enter your organization name"
          placeholderTextColor={isDarkMode ? '#999' : '#666'}
        />
      </View>

      <View style={styles.inputGroup}>
        <Text style={[styles.inputLabel, isDarkMode && styles.darkText]}>Organization Type</Text>
        <View style={styles.optionContainer}>
          {organizationTypes.map((type) => (
            <TouchableOpacity
              key={type.value}
              style={[
                styles.optionButton,
                organizationType === type.value && styles.optionButtonSelected
              ]}
              onPress={() => setOrganizationType(type.value)}
            >
              <Text style={[
                styles.optionButtonText,
                organizationType === type.value && styles.optionButtonTextSelected
              ]}>
                {type.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      <View style={styles.inputGroup}>
        <Text style={[styles.inputLabel, isDarkMode && styles.darkText]}>Currency</Text>
        <View style={styles.optionContainer}>
          {currencies.map((curr) => (
            <TouchableOpacity
              key={curr}
              style={[
                styles.optionButton,
                currency === curr && styles.optionButtonSelected
              ]}
              onPress={() => setCurrency(curr)}
            >
              <Text style={[
                styles.optionButtonText,
                currency === curr && styles.optionButtonTextSelected
              ]}>
                {curr}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      <TouchableOpacity
        style={[styles.submitButton, loading && styles.disabledButton]}
        onPress={handleCreateShop}
        disabled={loading}
      >
        <Text style={styles.submitButtonText}>
          {loading ? 'Creating...' : 'Create Organization'}
        </Text>
      </TouchableOpacity>
    </View>
  );

  const renderJoinMode = () => (
    <View style={styles.formContainer}>
      <TouchableOpacity
        style={styles.backButton}
        onPress={() => setMode('choose')}
      >
        <Icon name="arrow-left" size={20} color={isDarkMode ? '#fff' : '#007bff'} />
        <Text style={[styles.backButtonText, isDarkMode && styles.darkText]}>Back</Text>
      </TouchableOpacity>

      <Text style={[styles.formTitle, isDarkMode && styles.darkText]}>
        Join Existing Organization
      </Text>

      <View style={styles.inputGroup}>
        <Text style={[styles.inputLabel, isDarkMode && styles.darkText]}>Organization PIN</Text>
        <TextInput
          style={[styles.input, isDarkMode && styles.darkInput]}
          value={shopPin}
          onChangeText={setShopPin}
          placeholder="Enter 6-digit organization PIN"
          placeholderTextColor={isDarkMode ? '#999' : '#666'}
          keyboardType="numeric"
          maxLength={6}
        />
      </View>

      <TouchableOpacity
        style={[styles.submitButton, loading && styles.disabledButton]}
        onPress={handleJoinShop}
        disabled={loading}
      >
        <Text style={styles.submitButtonText}>
          {loading ? 'Joining...' : 'Join Organization'}
        </Text>
      </TouchableOpacity>

      <View style={styles.divider}>
        <View style={styles.dividerLine} />
        <Text style={[styles.dividerText, isDarkMode && styles.darkText]}>OR</Text>
        <View style={styles.dividerLine} />
      </View>

      <TouchableOpacity
        style={[styles.scanButton, loading && styles.disabledButton]}
        onPress={startQRScanner}
        disabled={loading}
      >
        <Icon name="qrcode-scan" size={24} color="#fff" />
        <Text style={styles.scanButtonText}>Scan QR Code</Text>
      </TouchableOpacity>
    </View>
  );

  return (
    <KeyboardAvoidingView 
      style={[styles.container, isDarkMode && styles.darkContainer]}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      {/* Logo */}
      <View style={styles.logoContainer}>
        <Image
          source={require('../assets/images/icon.png')}
          style={styles.logo}
          resizeMode="contain"
        />
        <Text style={[styles.title, isDarkMode && styles.darkText]}>
          VMStock
        </Text>
      </View>

      {/* Content */}
      {mode === 'choose' && renderChooseMode()}
      {mode === 'create' && renderCreateMode()}
      {mode === 'join' && renderJoinMode()}

      {/* QR Scanner Modal */}
      <Modal
        visible={showScanner}
        animationType="slide"
        presentationStyle="fullScreen"
      >
        <View style={styles.scannerContainer}>
          <View style={styles.scannerHeader}>
            <TouchableOpacity
              style={styles.scannerCloseButton}
              onPress={() => setShowScanner(false)}
            >
              <Icon name="close" size={24} color="#fff" />
            </TouchableOpacity>
            <Text style={styles.scannerTitle}>Scan QR Code</Text>
          </View>
          
          {hasPermission === null ? (
            <View style={styles.permissionContainer}>
              <Text style={styles.permissionText}>Requesting camera permission...</Text>
            </View>
          ) : hasPermission === false ? (
            <View style={styles.permissionContainer}>
              <Text style={styles.permissionText}>No access to camera</Text>
              <TouchableOpacity
                style={styles.permissionButton}
                onPress={requestCameraPermission}
              >
                <Text style={styles.permissionButtonText}>Grant Permission</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <CameraView
              onBarcodeScanned={handleBarCodeScanned}
              barcodeScannerSettings={{
                barcodeTypes: ["qr", "pdf417"],
              }}
              style={styles.scanner}
            />
          )}
          
          <View style={styles.scannerInstructions}>
            <Text style={styles.instructionText}>
              Point your camera at a QR code to scan the organization PIN
            </Text>
          </View>
        </View>
      </Modal>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
    padding: 20,
  },
  darkContainer: {
    backgroundColor: '#1a1a1a',
  },
  logoContainer: {
    alignItems: 'center',
    marginTop: 50,
    marginBottom: 40,
  },
  logo: {
    width: 80,
    height: 80,
    marginBottom: 20,
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 8,
  },
  darkText: {
    color: '#fff',
  },
  formContainer: {
    flex: 1,
  },
  formTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 8,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 16,
    color: '#666',
    textAlign: 'center',
    marginBottom: 30,
  },
  darkSubtitle: {
    color: '#ccc',
  },
  modeButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 20,
    marginBottom: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
  },
  modeButtonContent: {
    marginLeft: 12,
    flex: 1,
  },
  createButton: {
    borderLeftWidth: 4,
    borderLeftColor: '#28a745',
  },
  joinButton: {
    borderLeftWidth: 4,
    borderLeftColor: '#007bff',
  },
  modeButtonText: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 4,
  },
  modeButtonSubtext: {
    fontSize: 14,
    color: '#666',
  },
  backButton: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    marginBottom: 20,
  },
  backButtonText: {
    fontSize: 16,
    color: '#007bff',
    marginLeft: 8,
  },
  inputGroup: {
    marginBottom: 20,
  },
  inputLabel: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
    marginBottom: 8,
  },
  input: {
    backgroundColor: '#fff',
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
    borderWidth: 1,
    borderColor: '#ddd',
  },
  darkInput: {
    backgroundColor: '#333',
    borderColor: '#555',
    color: '#fff',
  },
  optionContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  optionButton: {
    backgroundColor: '#fff',
    borderRadius: 8,
    padding: 12,
    minWidth: 80,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#ddd',
  },
  optionButtonSelected: {
    backgroundColor: '#007bff',
    borderColor: '#007bff',
  },
  optionButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#333',
  },
  optionButtonTextSelected: {
    color: '#fff',
  },
  submitButton: {
    backgroundColor: '#007bff',
    borderRadius: 8,
    padding: 16,
    alignItems: 'center',
    marginTop: 20,
  },
  disabledButton: {
    opacity: 0.6,
  },
  submitButtonText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: 'bold',
  },
  divider: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 20,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: '#ddd',
  },
  dividerText: {
    marginHorizontal: 15,
    fontSize: 14,
    color: '#666',
    fontWeight: '500',
  },
  scanButton: {
    backgroundColor: '#28a745',
    borderRadius: 8,
    padding: 16,
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'center',
  },
  scanButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
    marginLeft: 8,
  },
  // QR Scanner styles
  scannerContainer: {
    flex: 1,
    backgroundColor: '#000',
  },
  scannerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 20,
    paddingTop: 60,
    backgroundColor: 'rgba(0, 0, 0, 0.8)',
  },
  scannerCloseButton: {
    padding: 8,
  },
  scannerTitle: {
    flex: 1,
    textAlign: 'center',
    fontSize: 18,
    fontWeight: 'bold',
    color: '#fff',
    marginRight: 40, // Offset for close button
  },
  scanner: {
    flex: 1,
  },
  scannerInstructions: {
    position: 'absolute',
    bottom: 100,
    left: 20,
    right: 20,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    borderRadius: 8,
    padding: 16,
  },
  instructionText: {
    color: '#fff',
    fontSize: 16,
    textAlign: 'center',
    lineHeight: 22,
  },
  permissionContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  permissionText: {
    color: '#fff',
    fontSize: 18,
    textAlign: 'center',
    marginBottom: 20,
  },
  permissionButton: {
    backgroundColor: '#007bff',
    borderRadius: 8,
    padding: 12,
    paddingHorizontal: 24,
  },
  permissionButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },
});