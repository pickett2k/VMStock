import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Alert,
  Modal,
  ScrollView,
  Share,
  Clipboard,
  Image,
  Keyboard,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import QRCode from 'react-native-qrcode-svg';
import * as ImagePicker from 'expo-image-picker';
import { ref, uploadBytes, getDownloadURL, deleteObject } from 'firebase/storage';
import { FirebaseStorage } from '../config/firebase';
import { useOrganization } from '../contexts/OrganizationContext';
import { useTheme } from '../app/ThemeContext';
import { hybridSyncService } from '../services/HybridSyncService';
import { ChargeReason } from '../types/firebase';

interface OrganizationSettingsProps {
  visible?: boolean;
  onClose?: () => void;
  onShowQR?: () => void;
  navigation?: any; // For screen navigation
}

export default function OrganizationSettings({ visible = true, onClose, onShowQR, navigation }: OrganizationSettingsProps) {
  const { organization, updateOrganization, refreshOrganization, loading: orgLoading } = useOrganization();
  const { isDarkMode } = useTheme();
  

  
  const [editMode, setEditMode] = useState(false);
  const [editedName, setEditedName] = useState('');
  const [showQR, setShowQR] = useState(false);
  const [loading, setLoading] = useState(false);
  const [editingCurrency, setEditingCurrency] = useState(false);
  const [editingType, setEditingType] = useState(false);
  const [selectedCurrency, setSelectedCurrency] = useState('');
  const [selectedType, setSelectedType] = useState('');
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [showQRModal, setShowQRModal] = useState(false);
  
  // Charge Reasons Management
  const [showChargeReasonsModal, setShowChargeReasonsModal] = useState(false);
  const [editingChargeReason, setEditingChargeReason] = useState<any>(null);
  const [newChargeReasonName, setNewChargeReasonName] = useState('');
  const [newChargeReasonDescription, setNewChargeReasonDescription] = useState('');
  
  // Staff Management
  const [showStaffManagementModal, setShowStaffManagementModal] = useState(false);
  const [staffUsers, setStaffUsers] = useState<any[]>([]);
  const [loadingStaff, setLoadingStaff] = useState(false);
  
  const currencies = ['GBP', 'EUR', 'USD'];
  const organizationTypes = [
    { value: 'tuck-shop', label: 'Tuck Shop' },
    { value: 'canteen', label: 'Canteen' },
    { value: 'cafeteria', label: 'Cafeteria' },
    { value: 'store', label: 'Store' }
  ];

  useEffect(() => {
    if (organization) {
      setEditedName(organization.displayName || organization.name);
      setSelectedCurrency(organization.currency || 'GBP');
      setSelectedType(organization.type || 'tuck-shop');
    }
  }, [organization]);

  // Charge Reasons Management Functions
  const getCurrentChargeReasons = (): ChargeReason[] => {
    return organization?.settings?.chargeReasons || [];
  };

  // Initialize default charge reasons if none exist
  const initializeDefaultChargeReasons = async () => {
    if (getCurrentChargeReasons().length > 0) {
      return; // Already has charge reasons
    }

    const defaultReasons: ChargeReason[] = [
      {
        id: 'fine',
        name: 'Fine',
        description: 'Penalty or disciplinary charge',
        isActive: true,
        createdAt: new Date() as any,
        updatedAt: new Date() as any,
      },
      {
        id: 'owed-sale',
        name: 'Owed Sale',
        description: 'Previously purchased item not yet paid for',
        isActive: true,
        createdAt: new Date() as any,
        updatedAt: new Date() as any,
      },
      {
        id: 'regular-fees',
        name: 'Regular Fees',
        description: 'Recurring fees or charges',
        isActive: true,
        createdAt: new Date() as any,
        updatedAt: new Date() as any,
      },
      {
        id: 'other',
        name: 'Other',
        description: 'Miscellaneous charges',
        isActive: true,
        createdAt: new Date() as any,
        updatedAt: new Date() as any,
      }
    ];

    try {
      await updateOrganization({
        settings: {
          ...organization?.settings,
          chargeReasons: defaultReasons,
          autoSyncInterval: organization?.settings?.autoSyncInterval || 300000
        }
      });
      console.log('✅ Default charge reasons initialized');
    } catch (error) {
      console.error('❌ Failed to initialize default charge reasons:', error);
    }
  };

  const handleAddChargeReason = async () => {
    if (!newChargeReasonName.trim()) {
      Alert.alert('Error', 'Please enter a charge reason name');
      return;
    }

    // Check for duplicate names
    const currentReasons = getCurrentChargeReasons();
    const duplicateName = currentReasons.find(
      reason => reason.name.toLowerCase() === newChargeReasonName.trim().toLowerCase()
    );
    
    if (duplicateName) {
      Alert.alert('Error', 'A charge reason with this name already exists');
      return;
    }

    try {
      const newReason: ChargeReason = {
        id: Date.now().toString(),
        name: newChargeReasonName.trim(),
        description: newChargeReasonDescription.trim() || undefined,
        isActive: true,
        createdAt: new Date() as any,
        updatedAt: new Date() as any,
      };

      const updatedReasons = [...currentReasons, newReason];

      await updateOrganization({
        settings: {
          ...organization?.settings,
          chargeReasons: updatedReasons,
          autoSyncInterval: organization?.settings?.autoSyncInterval || 300000
        }
      });

      // Clear form
      setNewChargeReasonName('');
      setNewChargeReasonDescription('');
      Alert.alert('Success', `"${newReason.name}" charge reason added successfully`);
    } catch (error) {
      console.error('Error adding charge reason:', error);
      Alert.alert('Error', 'Failed to add charge reason');
    }
  };

  const handleUpdateChargeReason = async (reasonId: string, updates: Partial<ChargeReason>) => {
    // Check for duplicate names (excluding the current reason being updated)
    if (updates.name) {
      const currentReasons = getCurrentChargeReasons();
      const duplicateName = currentReasons.find(
        reason => reason.id !== reasonId && 
        reason.name.toLowerCase() === updates.name!.trim().toLowerCase()
      );
      
      if (duplicateName) {
        Alert.alert('Error', 'A charge reason with this name already exists');
        return;
      }
    }

    try {
      const currentReasons = getCurrentChargeReasons();
      const updatedReasons = currentReasons.map(reason => 
        reason.id === reasonId 
          ? { ...reason, ...updates, updatedAt: new Date() as any }
          : reason
      );

      await updateOrganization({
        settings: {
          ...organization?.settings,
          chargeReasons: updatedReasons,
          autoSyncInterval: organization?.settings?.autoSyncInterval || 300000
        }
      });

      setEditingChargeReason(null);
      Alert.alert('Success', 'Charge reason updated successfully');
    } catch (error) {
      console.error('Error updating charge reason:', error);
      Alert.alert('Error', 'Failed to update charge reason');
    }
  };

  const handleDeleteChargeReason = async (reasonId: string) => {
    try {
      // Check if there are any existing charges using this reason
      const charges = await hybridSyncService.getChargesWithOverlay();
      const hasLinkedCharges = charges.some(charge => 
        charge.reason === reasonId && charge.status !== 'cancelled'
      );

      if (hasLinkedCharges) {
        Alert.alert(
          'Cannot Delete',
          'This charge reason cannot be deleted because there are existing unpaid charges using it. Please resolve all related charges first.',
          [{ text: 'OK' }]
        );
        return;
      }

      const reasonName = getCurrentChargeReasons().find(r => r.id === reasonId)?.name || 'this charge reason';

      Alert.alert(
        'Delete Charge Reason',
        `Are you sure you want to delete "${reasonName}"? This action cannot be undone.`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Delete',
            style: 'destructive',
            onPress: async () => {
              try {
                const currentReasons = getCurrentChargeReasons();
                const updatedReasons = currentReasons.filter(reason => reason.id !== reasonId);

                await updateOrganization({
                  settings: {
                    ...organization?.settings,
                    chargeReasons: updatedReasons,
                    autoSyncInterval: organization?.settings?.autoSyncInterval || 300000
                  }
                });

                Alert.alert('Success', 'Charge reason deleted successfully');
              } catch (error) {
                console.error('Error deleting charge reason:', error);
                Alert.alert('Error', 'Failed to delete charge reason');
              }
            }
          }
        ]
      );
    } catch (error) {
      console.error('Error checking for linked charges:', error);
      Alert.alert('Error', 'Failed to check for existing charges. Please try again.');
    }
  };

  // Refresh organization data when screen becomes visible
  useEffect(() => {
    console.log('🏢 OrganizationSettings - Component mounted/visible changed:', { visible, organization: !!organization, orgLoading });
    if (visible && !organization) {
      console.log('🔄 OrganizationSettings - No organization found, refreshing...');
      refreshOrganization();
    } else if (visible && organization) {
      console.log('✅ OrganizationSettings - Organization already loaded:', organization.name);
    }
  }, [visible]);

  // Debug organization state
  useEffect(() => {
    console.log('🏢 OrganizationSettings - Organization state changed:', {
      hasOrganization: !!organization,
      orgId: organization?.id,
      orgName: organization?.name,
      orgLoading
    });
  }, [organization, orgLoading]);

  // Debug: Log render attempt
  console.log('🏢 OrganizationSettings - Render attempt:', {
    visible,
    hasOnClose: !!onClose,
    orgLoading,
    hasOrganization: !!organization,
    orgId: organization?.id
  });

  // Show loading state while organization is being loaded
  if (orgLoading) {
    return (
      <View style={[styles.container, isDarkMode && styles.darkContainer, styles.centerContent]}>
        <Text style={[styles.loadingText, isDarkMode && styles.darkText]}>Loading organization settings...</Text>
      </View>
    );
  }

  // Show error state if no organization after loading
  if (!organization) {
    return (
      <View style={[styles.container, isDarkMode && styles.darkContainer, styles.centerContent]}>
        <Text style={[styles.loadingText, isDarkMode && styles.darkText]}>No organization found. Please contact support.</Text>
      </View>
    );
  }

  const handleSaveCurrency = async () => {
    setLoading(true);
    try {
      await updateOrganization({
        currency: selectedCurrency,
      });
      setEditingCurrency(false);
      Alert.alert('Success', 'Currency updated successfully');
    } catch (error) {
      console.error('Error updating currency:', error);
      Alert.alert('Error', 'Failed to update currency');
    } finally {
      setLoading(false);
    }
  };

  const handleSaveType = async () => {
    setLoading(true);
    try {
      await updateOrganization({
        type: selectedType as 'tuck-shop' | 'canteen' | 'store' | 'cafe',
      });
      setEditingType(false);
      Alert.alert('Success', 'Organization type updated successfully');
    } catch (error) {
      console.error('Error updating organization type:', error);
      Alert.alert('Error', 'Failed to update organization type');
    } finally {
      setLoading(false);
    }
  };

  const requestPermission = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission needed', 'Sorry, we need camera roll permissions to upload a logo!');
      return false;
    }
    return true;
  };

  const uploadLogoToFirebase = async (uri: string): Promise<string> => {
    const response = await fetch(uri);
    const blob = await response.blob();
    
    // Create a reference to the logo file in Firebase Storage
    const logoRef = ref(FirebaseStorage, `organization-logos/${organization.id}/logo.jpg`);
    
    // Upload the file
    await uploadBytes(logoRef, blob);
    
    // Get the download URL
    const downloadURL = await getDownloadURL(logoRef);
    return downloadURL;
  };

  const handleLogoUpload = async () => {
    const hasPermission = await requestPermission();
    if (!hasPermission) return;

    Alert.alert(
      'Select Logo',
      'Choose how you want to select your organization logo:',
      [
        {
          text: 'Camera',
          onPress: () => pickImage(true),
        },
        {
          text: 'Photo Library',
          onPress: () => pickImage(false),
        },
        {
          text: 'Cancel',
          style: 'cancel',
        },
      ]
    );
  };

  const pickImage = async (useCamera: boolean) => {
    try {
      setUploadingLogo(true);
      
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.7,
        base64: false,
      });

      if (!result.canceled && result.assets[0]) {
        const logoUrl = await uploadLogoToFirebase(result.assets[0].uri);
        
        await updateOrganization({
          logoUrl,
        });
        
        Alert.alert('Success', 'Logo uploaded successfully!');
      }
    } catch (error) {
      console.error('Error uploading logo:', error);
      Alert.alert('Error', 'Failed to upload logo. Please try again.');
    } finally {
      setUploadingLogo(false);
    }
  };

  const handleRemoveLogo = async () => {
    Alert.alert(
      'Remove Logo',
      'Are you sure you want to remove the organization logo?',
      [
        {
          text: 'Cancel',
          style: 'cancel',
        },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            try {
              setLoading(true);
              
              // Delete from Firebase Storage if exists
              if (organization.logoUrl) {
                try {
                  const logoRef = ref(FirebaseStorage, `organization-logos/${organization.id}/logo.jpg`);
                  await deleteObject(logoRef);
                } catch (storageError) {
                  console.warn('Logo file not found in storage, continuing with database update');
                }
              }
              
              // Update organization to remove logoUrl
              await updateOrganization({
                logoUrl: '',
              });
              
              Alert.alert('Success', 'Logo removed successfully');
            } catch (error) {
              console.error('Error removing logo:', error);
              Alert.alert('Error', 'Failed to remove logo');
            } finally {
              setLoading(false);
            }
          },
        },
      ]
    );
  };

  const handleSaveName = async () => {
    if (!editedName.trim()) {
      Alert.alert('Error', 'Organization name cannot be empty');
      return;
    }

    setLoading(true);
    try {
      await updateOrganization({
        name: editedName.trim(),
        displayName: editedName.trim(),
      });
      setEditMode(false);
      Alert.alert('Success', 'Organization name updated successfully');
    } catch (error) {
      Alert.alert('Error', 'Failed to update organization name');
    } finally {
      setLoading(false);
    }
  };

  const handleSharePin = async () => {
    try {
      await Share.share({
        message: `Join our shop! Use PIN: ${organization.shopPin}\n\nDownload VMStock app and enter this PIN to join "${organization.displayName}".`,
        title: 'Join Our Shop',
      });
    } catch (error) {
      console.log('Share failed:', error);
    }
  };

  const handleCopyPin = () => {
    if (organization.shopPin) {
      Clipboard.setString(organization.shopPin);
      Alert.alert('Copied!', 'Shop PIN copied to clipboard');
    }
  };

  const generateQRData = () => {
    return JSON.stringify({
      type: 'vmstock_organization',
      shopPin: organization.shopPin,
      name: organization.displayName,
      currency: organization.currency,
    });
  };

  const handleShareQR = async () => {
    // QR sharing would require generating an image - for now just share the PIN
    Alert.alert(
      'Share Options',
      'Choose how to share your organization:',
      [
        { text: 'Share PIN', onPress: handleSharePin },
        { text: 'Show QR Code', onPress: () => setShowQR(true) },
        { text: 'Cancel', style: 'cancel' },
      ]
    );
  };

  // Staff Management Functions - Using offline-first architecture
  const loadStaffUsers = async () => {
    if (!organization?.id) return;
    
    setLoadingStaff(true);
    try {
      // Use AsyncStorage directly for now - staff users should be handled through HybridSyncService overlay
      // This is a temporary solution until we implement getStaffUsersWithOverlay
      const staffKey = `staff-users_${organization.id}`;
      const staffData = await AsyncStorage.getItem(staffKey);
      const staff = staffData ? JSON.parse(staffData) : [];
      setStaffUsers(staff);
    } catch (error) {
      console.error('Error loading staff users:', error);
      Alert.alert('Error', 'Failed to load staff users');
    } finally {
      setLoadingStaff(false);
    }
  };

  const handlePromoteToAdmin = async (staffUser: any) => {
    Alert.alert(
      'Promote to Admin',
      `Are you sure you want to promote ${staffUser.displayName} to admin? They will have full management access to this organization.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { 
          text: 'Promote', 
          style: 'destructive',
          onPress: async () => {
            try {
              // TODO: Implement staff user operations in HybridSyncService with proper offline-first architecture
              Alert.alert('Info', 'Staff management is being updated to use offline-first architecture. This feature will be available soon.');
            } catch (error) {
              console.error('Error promoting user:', error);
              Alert.alert('Error', 'Failed to promote user');
            }
          }
        }
      ]
    );
  };

  const handleDemoteFromAdmin = async (staffUser: any) => {
    Alert.alert(
      'Remove Admin Access',
      `Staff management is being updated to use offline-first architecture. This feature will be available soon.`,
      [{ text: 'OK' }]
    );
  };

  // Only check visible prop when used as modal (has onClose prop)
  // When used as a screen navigation, visible should always be true
  if (onClose && !visible) return null;

  return (
    <ScrollView 
      style={[styles.container, isDarkMode && styles.darkContainer]}
      contentContainerStyle={styles.scrollContent}
      showsVerticalScrollIndicator={true}
      bounces={true}
    >
            {/* Organization Name */}
            <View style={styles.section}>
              <Text style={[styles.sectionTitle, isDarkMode && styles.darkText]}>
                Organization Name
              </Text>
              <View style={styles.nameContainer}>
                {editMode ? (
                  <View style={styles.editContainer}>
                    <TextInput
                      style={[styles.nameInput, isDarkMode && styles.darkInput]}
                      value={editedName}
                      onChangeText={setEditedName}
                      placeholder="Organization name"
                      placeholderTextColor={isDarkMode ? '#999' : '#666'}
                      returnKeyType="done"
                      onSubmitEditing={Keyboard.dismiss}
                    />
                    <View style={styles.editButtons}>
                      <TouchableOpacity
                        onPress={() => {
                          setEditedName(organization.displayName || organization.name);
                          setEditMode(false);
                        }}
                        style={[styles.editButton, styles.cancelButton]}
                      >
                        <Icon name="close" size={16} color="#fff" />
                      </TouchableOpacity>
                      <TouchableOpacity
                        onPress={handleSaveName}
                        style={[styles.editButton, styles.saveButton]}
                        disabled={loading}
                      >
                        <Icon name="check" size={16} color="#fff" />
                      </TouchableOpacity>
                    </View>
                  </View>
                ) : (
                  <View style={styles.nameDisplay}>
                    <Text style={[styles.nameText, isDarkMode && styles.darkText]}>
                      {organization.displayName || organization.name}
                    </Text>
                    <TouchableOpacity
                      onPress={() => setEditMode(true)}
                      style={styles.editIcon}
                    >
                      <Icon name="pencil" size={20} color="#007bff" />
                    </TouchableOpacity>
                  </View>
                )}
              </View>
            </View>

            {/* Shop PIN */}
            <View style={styles.section}>
              <Text style={[styles.sectionTitle, isDarkMode && styles.darkText]}>
                Shop PIN
              </Text>
              <View style={styles.pinContainer}>
                <View style={styles.pinDisplay}>
                  <Text style={[styles.pinText, isDarkMode && styles.darkText]}>
                    {organization.shopPin}
                  </Text>
                  <Text style={[styles.pinDescription, isDarkMode && styles.darkSubtext]}>
                    Share this PIN for others to join your shop
                  </Text>
                </View>
                <View style={styles.pinActions}>
                  <TouchableOpacity onPress={handleCopyPin} style={styles.pinButton}>
                    <Icon name="content-copy" size={20} color="#007bff" />
                    <Text style={[styles.pinButtonText, { color: '#007bff' }]}>
                      Copy
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity onPress={handleSharePin} style={styles.pinButton}>
                    <Icon name="share-variant" size={20} color="#28a745" />
                    <Text style={[styles.pinButtonText, { color: '#28a745' }]}>
                      Share
                    </Text>
                  </TouchableOpacity>
                </View>
              </View>
            </View>

            {/* Organization Logo */}
            <View style={styles.section}>
              <Text style={[styles.sectionTitle, isDarkMode && styles.darkText]}>
                Organization Logo
              </Text>
              <Text style={[styles.sectionDescription, isDarkMode && styles.darkSubtext]}>
                Upload a custom logo for your organization
              </Text>
              <View style={styles.logoContainer}>
                {organization.logoUrl ? (
                  <Image 
                    source={{ uri: organization.logoUrl }} 
                    style={styles.logoPreview}
                    resizeMode="contain"
                  />
                ) : (
                  <View style={[styles.logoPlaceholder, isDarkMode && styles.darkLogoPlaceholder]}>
                    <Icon name="image-outline" size={40} color="#ccc" />
                    <Text style={[styles.logoPlaceholderText, isDarkMode && styles.darkSubtext]}>
                      No logo uploaded
                    </Text>
                  </View>
                )}
                
                <View style={styles.logoActions}>
                  <TouchableOpacity 
                    style={[styles.uploadButton, isDarkMode && styles.darkButton]}
                    onPress={handleLogoUpload}
                    disabled={uploadingLogo}
                  >
                    <Icon name="camera-plus" size={20} color="#007bff" />
                    <Text style={[styles.uploadButtonText, isDarkMode && styles.darkText]}>
                      {uploadingLogo ? 'Uploading...' : (organization.logoUrl ? 'Change Logo' : 'Upload Logo')}
                    </Text>
                  </TouchableOpacity>
                  
                  {organization.logoUrl && (
                    <TouchableOpacity 
                      style={[styles.removeButton, isDarkMode && styles.darkRemoveButton]}
                      onPress={handleRemoveLogo}
                      disabled={loading}
                    >
                      <Icon name="delete" size={20} color="#dc3545" />
                      <Text style={[styles.removeButtonText, isDarkMode && styles.darkText]}>
                        Remove
                      </Text>
                    </TouchableOpacity>
                  )}
                </View>
              </View>
            </View>

            {/* Currency */}
            <View style={styles.section}>
              <View style={styles.sectionHeader}>
                <Text style={[styles.sectionTitle, isDarkMode && styles.darkText]}>
                  Currency
                </Text>
                {!editingCurrency && (
                  <TouchableOpacity onPress={() => setEditingCurrency(true)}>
                    <Icon name="pencil" size={20} color="#007bff" />
                  </TouchableOpacity>
                )}
              </View>
              
              {editingCurrency ? (
                <View style={styles.editContainer}>
                  <View style={styles.pickerContainer}>
                    {currencies.map((currency) => (
                      <TouchableOpacity
                        key={currency}
                        style={[
                          styles.pickerOption,
                          selectedCurrency === currency && styles.pickerOptionSelected,
                          isDarkMode && styles.darkPickerOption
                        ]}
                        onPress={() => setSelectedCurrency(currency)}
                      >
                        <Text style={[
                          styles.pickerOptionText,
                          selectedCurrency === currency && styles.pickerOptionTextSelected,
                          isDarkMode && styles.darkText
                        ]}>
                          {currency}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                  <View style={styles.editActions}>
                    <TouchableOpacity
                      style={[styles.cancelButton, isDarkMode && styles.darkCancelButton]}
                      onPress={() => {
                        setEditingCurrency(false);
                        setSelectedCurrency(organization.currency || 'GBP');
                      }}
                    >
                      <Text style={[styles.cancelButtonText, isDarkMode && styles.darkButtonText]}>Cancel</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.saveButton, isDarkMode && styles.darkSaveButton]}
                      onPress={handleSaveCurrency}
                      disabled={loading}
                    >
                      <Text style={styles.saveButtonText}>{loading ? 'Saving...' : 'Save'}</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              ) : (
                <View style={styles.currencyContainer}>
                  <Text style={[styles.currencyText, isDarkMode && styles.darkText]}>
                    {organization.currency}
                  </Text>
                </View>
              )}
            </View>

            {/* Organization Type */}
            <View style={styles.section}>
              <View style={styles.sectionHeader}>
                <Text style={[styles.sectionTitle, isDarkMode && styles.darkText]}>
                  Organization Type
                </Text>
                {!editingType && (
                  <TouchableOpacity onPress={() => setEditingType(true)}>
                    <Icon name="pencil" size={20} color="#007bff" />
                  </TouchableOpacity>
                )}
              </View>
              
              {editingType ? (
                <View style={styles.editContainer}>
                  <View style={styles.pickerContainer}>
                    {organizationTypes.map((type) => (
                      <TouchableOpacity
                        key={type.value}
                        style={[
                          styles.pickerOption,
                          selectedType === type.value && styles.pickerOptionSelected,
                          isDarkMode && styles.darkPickerOption
                        ]}
                        onPress={() => setSelectedType(type.value)}
                      >
                        <Text style={[
                          styles.pickerOptionText,
                          selectedType === type.value && styles.pickerOptionTextSelected,
                          isDarkMode && styles.darkText
                        ]}>
                          {type.label}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                  <View style={styles.editActions}>
                    <TouchableOpacity
                      style={[styles.cancelButton, isDarkMode && styles.darkCancelButton]}
                      onPress={() => {
                        setEditingType(false);
                        setSelectedType(organization.type || 'tuck-shop');
                      }}
                    >
                      <Text style={[styles.cancelButtonText, isDarkMode && styles.darkButtonText]}>Cancel</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.saveButton, isDarkMode && styles.darkSaveButton]}
                      onPress={handleSaveType}
                      disabled={loading}
                    >
                      <Text style={styles.saveButtonText}>{loading ? 'Saving...' : 'Save'}</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              ) : (
                <View style={styles.typeContainer}>
                  <Text style={[styles.typeText, isDarkMode && styles.darkText]}>
                    {organizationTypes.find(t => t.value === organization.type)?.label || 'Tuck Shop'}
                  </Text>
                </View>
              )}
            </View>



            {/* QR Code */}
            <View style={styles.section}>
              <Text style={[styles.sectionTitle, isDarkMode && styles.darkText]}>
                QR Code
              </Text>
              <Text style={[styles.sectionDescription, isDarkMode && styles.darkSubtext]}>
                Generate a QR code for easy organization sharing
              </Text>
              <TouchableOpacity
                onPress={() => {
                  console.log('🔍 QR Code button pressed');
                  if (!organization.shopPin) {
                    Alert.alert('PIN Not Available', 'Organization PIN is not set. Please update organization settings first.');
                    return;
                  }
                  setShowQRModal(true);
                }}
                style={[styles.qrButton, isDarkMode && styles.darkButton]}
              >
                <Icon name="qrcode" size={24} color="#007bff" />
                <Text style={[styles.qrButtonText, isDarkMode && styles.darkText]}>
                  Show QR Code
                </Text>
              </TouchableOpacity>
            </View>

            {/* Organization Info */}
            <View style={styles.section}>
              <Text style={[styles.sectionTitle, isDarkMode && styles.darkText]}>
                Organization Details
              </Text>
              <View style={styles.infoGrid}>
                <View style={styles.infoItem}>
                  <Text style={[styles.infoLabel, isDarkMode && styles.darkSubtext]}>
                    Type
                  </Text>
                  <Text style={[styles.infoValue, isDarkMode && styles.darkText]}>
                    {organization.type ? organization.type.replace('-', ' ').replace(/\b\w/g, l => l.toUpperCase()) : 'Tuck Shop'}
                  </Text>
                </View>
                <View style={styles.infoItem}>
                  <Text style={[styles.infoLabel, isDarkMode && styles.darkSubtext]}>
                    Currency
                  </Text>
                  <Text style={[styles.infoValue, isDarkMode && styles.darkText]}>
                    {organization.currency}
                  </Text>
                </View>
              </View>
            </View>

            {/* Staff Management */}
            <View style={styles.section}>
              <Text style={[styles.sectionTitle, isDarkMode && styles.darkText]}>
                Staff Management
              </Text>
              <Text style={[styles.sectionDescription, isDarkMode && styles.darkSubtext]}>
                Manage admin roles and permissions for organization members
              </Text>
              
              <TouchableOpacity
                onPress={() => {
                  setShowStaffManagementModal(true);
                  loadStaffUsers();
                }}
                style={[styles.manageButton, isDarkMode && styles.darkButton]}
              >
                <Icon name="account-group" size={20} color="#007bff" />
                <Text style={[styles.manageButtonText, isDarkMode && styles.darkText]}>
                  Manage Staff & Admins
                </Text>
              </TouchableOpacity>
            </View>

            {/* Charge Reasons Management */}
            <View style={styles.section}>
              <Text style={[styles.sectionTitle, isDarkMode && styles.darkText]}>
                Charge Reasons
              </Text>
              <Text style={[styles.sectionDescription, isDarkMode && styles.darkSubtext]}>
                Manage custom charge reasons for player bills
              </Text>
              
              <TouchableOpacity
                onPress={() => setShowChargeReasonsModal(true)}
                style={[styles.manageButton, isDarkMode && styles.darkButton]}
              >
                <Icon name="cog" size={20} color="#007bff" />
                <Text style={[styles.manageButtonText, isDarkMode && styles.darkText]}>
                  Manage Charge Reasons ({getCurrentChargeReasons().length})
                </Text>
              </TouchableOpacity>
            </View>

            {/* QR Code Modal */}
            <Modal visible={showQRModal} animationType="fade" transparent>
              <View style={styles.qrOverlay}>
                <View style={[styles.qrModal, isDarkMode && styles.darkQrModal]}>
                  <View style={styles.qrHeader}>
                    <Text style={[styles.qrTitle, isDarkMode && styles.darkText]}>
                      Organization QR Code
                    </Text>
                    <TouchableOpacity onPress={() => setShowQRModal(false)}>
                      <Icon name="close" size={24} color={isDarkMode ? '#fff' : '#333'} />
                    </TouchableOpacity>
                  </View>
                  
                  <View style={styles.qrCodeContainer}>
                    {organization.shopPin && (
                      <QRCode
                        value={generateQRData()}
                        size={200}
                        backgroundColor="white"
                        color="black"
                      />
                    )}
                  </View>
                  
                  <Text style={[styles.qrInstructions, isDarkMode && styles.darkText]}>
                    Users can scan this QR code or use PIN: {organization.shopPin} to join "{organization.displayName}"
                  </Text>
                  
                  <View style={styles.qrActions}>
                    <TouchableOpacity
                      style={[styles.qrActionButton, styles.shareButton]}
                      onPress={handleSharePin}
                    >
                      <Icon name="share" size={20} color="#fff" />
                      <Text style={styles.qrActionButtonText}>Share PIN</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              </View>
            </Modal>

            {/* Staff Management Modal */}
            <Modal visible={showStaffManagementModal} animationType="slide" transparent>
              <View style={styles.chargeModalOverlay}>
                <View style={[styles.chargeModalContainer, isDarkMode && styles.darkChargeModalContainer]}>
                  <View style={styles.chargeModalHeader}>
                    <Text style={[styles.chargeModalTitle, isDarkMode && styles.darkText]}>
                      Staff Management
                    </Text>
                    <TouchableOpacity onPress={() => setShowStaffManagementModal(false)}>
                      <Icon name="close" size={24} color={isDarkMode ? '#fff' : '#333'} />
                    </TouchableOpacity>
                  </View>
                  
                  <ScrollView style={styles.chargeModalContent}>
                    {loadingStaff ? (
                      <View style={styles.centerContent}>
                        <Text style={[styles.loadingText, isDarkMode && styles.darkText]}>
                          Loading staff members...
                        </Text>
                      </View>
                    ) : (
                      <>
                        <Text style={[styles.staffDescription, isDarkMode && styles.darkSubtext]}>
                          Manage admin permissions for your organization members. Admins can manage products, users, and view reports.
                        </Text>
                        
                        {staffUsers.map((staff) => (
                          <View key={staff.id} style={[styles.staffItem, isDarkMode && styles.darkStaffItem]}>
                            <View style={styles.staffInfo}>
                              <Text style={[styles.staffName, isDarkMode && styles.darkText]}>
                                {staff.displayName}
                              </Text>
                              <Text style={[styles.staffEmail, isDarkMode && styles.darkSubtext]}>
                                {staff.email}
                              </Text>
                              <View style={styles.roleContainer}>
                                <Text style={[
                                  styles.roleTag, 
                                  staff.role === 'admin' || staff.role === 'owner' ? styles.adminRole : styles.userRole,
                                  isDarkMode && styles.darkRoleTag
                                ]}>
                                  {staff.role === 'owner' ? 'Owner' : staff.role === 'admin' ? 'Admin' : 'User'}
                                </Text>
                              </View>
                            </View>
                            
                            {staff.role !== 'owner' && (
                              <View style={styles.staffActions}>
                                {staff.role === 'admin' ? (
                                  <TouchableOpacity
                                    onPress={() => handleDemoteFromAdmin(staff)}
                                    style={[styles.actionButton, styles.demoteButton]}
                                  >
                                    <Icon name="account-arrow-down" size={16} color="#fff" />
                                    <Text style={styles.actionButtonText}>Remove Admin</Text>
                                  </TouchableOpacity>
                                ) : (
                                  <TouchableOpacity
                                    onPress={() => handlePromoteToAdmin(staff)}
                                    style={[styles.actionButton, styles.promoteButton]}
                                  >
                                    <Icon name="account-arrow-up" size={16} color="#fff" />
                                    <Text style={styles.actionButtonText}>Make Admin</Text>
                                  </TouchableOpacity>
                                )}
                              </View>
                            )}
                          </View>
                        ))}
                        
                        {staffUsers.length === 0 && (
                          <View style={styles.centerContent}>
                            <Text style={[styles.noStaffText, isDarkMode && styles.darkSubtext]}>
                              No staff members found. Users will appear here when they join your organization.
                            </Text>
                          </View>
                        )}
                      </>
                    )}
                  </ScrollView>
                </View>
              </View>
            </Modal>

            {/* Charge Reasons Management Modal */}
            <Modal visible={showChargeReasonsModal} animationType="slide" transparent>
              <View style={styles.chargeModalOverlay}>
                <View style={[styles.chargeModalContainer, isDarkMode && styles.darkChargeModalContainer]}>
                  <View style={styles.chargeModalHeader}>
                    <Text style={[styles.chargeModalTitle, isDarkMode && styles.darkText]}>
                      Manage Charge Reasons
                    </Text>
                    <TouchableOpacity onPress={() => setShowChargeReasonsModal(false)}>
                      <Icon name="close" size={24} color={isDarkMode ? '#fff' : '#333'} />
                    </TouchableOpacity>
                  </View>
                  
                  <ScrollView style={styles.chargeReasonsContent} showsVerticalScrollIndicator={false}>
                    {/* Add New Charge Reason */}
                    <View style={styles.addChargeReasonSection}>
                      <Text style={[styles.chargeReasonSectionTitle, isDarkMode && styles.darkText]}>
                        Add New Charge Reason
                      </Text>
                      <TextInput
                        style={[styles.chargeReasonInput, isDarkMode && styles.darkChargeReasonInput]}
                        placeholder="Charge reason name (e.g., Fine, Owed Sale)"
                        placeholderTextColor={isDarkMode ? '#999' : '#666'}
                        value={newChargeReasonName}
                        onChangeText={setNewChargeReasonName}
                      />
                      <TextInput
                        style={[styles.chargeReasonInput, isDarkMode && styles.darkChargeReasonInput]}
                        placeholder="Description (optional)"
                        placeholderTextColor={isDarkMode ? '#999' : '#666'}
                        value={newChargeReasonDescription}
                        onChangeText={setNewChargeReasonDescription}
                        multiline
                      />
                      <TouchableOpacity
                        style={[styles.addButton, isDarkMode && styles.darkButton]}
                        onPress={handleAddChargeReason}
                      >
                        <Icon name="plus" size={20} color="#fff" />
                        <Text style={styles.addButtonText}>Add Charge Reason</Text>
                      </TouchableOpacity>
                    </View>

                    {/* Existing Charge Reasons */}
                    <View style={styles.chargeReasonsListSection}>
                      <Text style={[styles.chargeReasonSectionTitle, isDarkMode && styles.darkText]}>
                        Existing Charge Reasons ({getCurrentChargeReasons().length})
                      </Text>
                      {getCurrentChargeReasons().length === 0 ? (
                        <View style={styles.emptyState}>
                          <Icon name="format-list-bulleted" size={48} color={isDarkMode ? '#666' : '#ccc'} />
                          <Text style={[styles.emptyStateText, isDarkMode && styles.darkSubtext]}>
                            No charge reasons yet. Add one above or initialize with defaults.
                          </Text>
                          <TouchableOpacity
                            style={[styles.initializeButton, isDarkMode && styles.darkInitializeButton]}
                            onPress={initializeDefaultChargeReasons}
                          >
                            <Icon name="auto-fix" size={20} color="#007bff" />
                            <Text style={styles.initializeButtonText}>Add Default Reasons</Text>
                          </TouchableOpacity>
                        </View>
                      ) : (
                        getCurrentChargeReasons().map((reason) => (
                          <View key={reason.id} style={[styles.chargeReasonItem, isDarkMode && styles.darkChargeReasonItem]}>
                            {editingChargeReason?.id === reason.id ? (
                              <>
                                <TextInput
                                  style={[styles.chargeReasonInput, isDarkMode && styles.darkChargeReasonInput]}
                                  value={editingChargeReason.name}
                                  onChangeText={(text) => setEditingChargeReason({...editingChargeReason, name: text})}
                                />
                                <TextInput
                                  style={[styles.chargeReasonInput, isDarkMode && styles.darkChargeReasonInput]}
                                  value={editingChargeReason.description || ''}
                                  onChangeText={(text) => setEditingChargeReason({...editingChargeReason, description: text})}
                                  placeholder="Description (optional)"
                                  placeholderTextColor={isDarkMode ? '#999' : '#666'}
                                  multiline
                                />
                                <View style={styles.chargeReasonActions}>
                                  <TouchableOpacity
                                    style={[styles.chargeSaveButton, isDarkMode && styles.darkChargeSaveButton]}
                                    onPress={() => handleUpdateChargeReason(reason.id, {
                                      name: editingChargeReason.name,
                                      description: editingChargeReason.description
                                    })}
                                  >
                                    <Icon name="check" size={16} color="#fff" />
                                  </TouchableOpacity>
                                  <TouchableOpacity
                                    style={[styles.chargeCancelButton, isDarkMode && styles.darkChargeCancelButton]}
                                    onPress={() => setEditingChargeReason(null)}
                                  >
                                    <Icon name="close" size={16} color="#666" />
                                  </TouchableOpacity>
                                </View>
                              </>
                            ) : (
                              <>
                                <View style={styles.chargeReasonInfo}>
                                  <Text style={[styles.chargeReasonName, isDarkMode && styles.darkText]}>
                                    {reason.name}
                                  </Text>
                                  {reason.description && (
                                    <Text style={[styles.chargeReasonDescription, isDarkMode && styles.darkSubtext]}>
                                      {reason.description}
                                    </Text>
                                  )}
                                </View>
                                <View style={styles.chargeReasonActions}>
                                  <TouchableOpacity
                                    style={[styles.chargeEditButton, isDarkMode && styles.darkChargeEditButton]}
                                    onPress={() => setEditingChargeReason(reason)}
                                  >
                                    <Icon name="pencil-outline" size={16} color="#007bff" />
                                  </TouchableOpacity>
                                  <TouchableOpacity
                                    style={[styles.chargeDeleteButton, isDarkMode && styles.darkChargeDeleteButton]}
                                    onPress={() => handleDeleteChargeReason(reason.id)}
                                  >
                                    <Icon name="delete-outline" size={16} color="#dc3545" />
                                  </TouchableOpacity>
                                </View>
                              </>
                            )}
                          </View>
                        ))
                      )}
                    </View>
                  </ScrollView>
                </View>
              </View>
            </Modal>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#f5f5f5',
  },
  darkContainer: {
    backgroundColor: '#1a1a1a',
  },
  scrollContent: {
    padding: 20,
    paddingBottom: 100, // Extra padding at bottom for scrolling
  },
  darkText: {  
    color: '#fff',
  },
  section: {
    marginBottom: 30,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 8,
  },
  sectionDescription: {
    fontSize: 14,
    color: '#666',
    marginBottom: 12,
  },
  darkSubtext: {
    color: '#ccc',
  },
  nameContainer: {
    backgroundColor: '#fff',
    borderRadius: 8,
    padding: 15,
  },
  nameDisplay: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  nameText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
    flex: 1,
  },
  editIcon: {
    padding: 5,
  },
  editContainer: {
    gap: 12,
  },
  nameInput: {
    fontSize: 16,
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 6,
    padding: 12,
    backgroundColor: '#fff',
  },
  darkInput: {
    backgroundColor: '#333',
    borderColor: '#555',
    color: '#fff',
  },
  editButtons: {
    flexDirection: 'row',
    gap: 8,
  },
  editButton: {
    flex: 1,
    padding: 10,
    borderRadius: 6,
    alignItems: 'center',
  },
  cancelButton: {
    backgroundColor: '#6c757d',
  },
  saveButton: {
    backgroundColor: '#28a745',
  },
  pinContainer: {
    backgroundColor: '#fff',
    borderRadius: 8,
    padding: 15,
  },
  pinDisplay: {
    marginBottom: 15,
  },
  pinText: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#333',
    textAlign: 'center',
    letterSpacing: 2,
    marginBottom: 5,
  },
  pinDescription: {
    fontSize: 14,
    color: '#666',
    textAlign: 'center',
  },
  pinActions: {
    flexDirection: 'row',
    gap: 10,
  },
  pinButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 12,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#ddd',
    gap: 8,
  },
  pinButtonText: {
    fontSize: 14,
    fontWeight: '600',
  },
  qrButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 15,
    backgroundColor: '#fff',
    borderRadius: 8,
    gap: 10,
  },
  darkButton: {
    backgroundColor: '#333',
  },
  qrButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
  },
  infoGrid: {
    flexDirection: 'row',
    gap: 15,
  },
  infoItem: {
    flex: 1,
    backgroundColor: '#fff',
    borderRadius: 8,
    padding: 15,
  },
  infoLabel: {
    fontSize: 12,
    color: '#666',
    marginBottom: 4,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  infoValue: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
  },
  // QR Modal styles
  qrOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  qrModal: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 20,
    width: '100%',
    maxWidth: 350,
  },
  darkQrModal: {
    backgroundColor: '#333',
  },
  qrHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },
  qrTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#333',
  },
  qrCodeContainer: {
    alignItems: 'center',
    marginBottom: 20,
    padding: 20,
  },
  qrInstructions: {
    fontSize: 14,
    color: '#666',
    textAlign: 'center',
    marginBottom: 20,
    lineHeight: 20,
  },
  qrActions: {
    gap: 10,
  },
  qrActionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 12,
    borderRadius: 8,
    gap: 8,
  },
  shareButton: {
    backgroundColor: '#28a745',
  },
  qrActionButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  // Currency and Type styles
  currencyContainer: {
    backgroundColor: '#fff',
    borderRadius: 8,
    padding: 15,
  },
  currencyText: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 4,
  },
  currencyDescription: {
    fontSize: 14,
    color: '#666',
  },
  typeContainer: {
    backgroundColor: '#fff',
    borderRadius: 8,
    padding: 15,
  },
  typeText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
    textTransform: 'capitalize',
  },
  
  // Editing styles
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  pickerContainer: {
    marginBottom: 15,
  },
  pickerOption: {
    backgroundColor: '#fff',
    padding: 12,
    borderRadius: 6,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#e9ecef',
  },
  pickerOptionSelected: {
    backgroundColor: '#007bff',
    borderColor: '#007bff',
  },
  darkPickerOption: {
    backgroundColor: '#444',
    borderColor: '#666',
  },
  pickerOptionText: {
    fontSize: 16,
    color: '#333',
    textAlign: 'center',
  },
  pickerOptionTextSelected: {
    color: '#fff',
    fontWeight: 'bold',
  },
  editActions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 10,
  },
  cancelButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },
  saveButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },
  darkCancelButton: {
    backgroundColor: '#555',
  },
  darkSaveButton: {
    backgroundColor: '#28a745',
  },
  darkButtonText: {
    color: '#fff',
  },
  
  // Logo upload styles
  logoContainer: {
    alignItems: 'center',
    padding: 20,
    backgroundColor: '#f8f9fa',
    borderRadius: 8,
  },
  logoPlaceholder: {
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: '#e9ecef',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 15,
    borderWidth: 2,
    borderColor: '#dee2e6',
    borderStyle: 'dashed',
  },
  darkLogoPlaceholder: {
    backgroundColor: '#444',
    borderColor: '#666',
  },
  logoPreview: {
    width: 120,
    height: 120,
    borderRadius: 60,
    marginBottom: 15,
  },
  logoPlaceholderText: {
    fontSize: 12,
    color: '#666',
    marginTop: 5,
    textAlign: 'center',
  },
  uploadButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#007bff',
  },
  uploadButtonText: {
    color: '#007bff',
    fontSize: 14,
    fontWeight: '600',
    marginLeft: 8,
  },
  logoActions: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 10,
    marginTop: 10,
  },
  removeButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#dc3545',
  },
  darkRemoveButton: {
    backgroundColor: '#444',
    borderColor: '#dc3545',
  },
  removeButtonText: {
    color: '#dc3545',
    fontSize: 14,
    fontWeight: '600',
    marginLeft: 8,
  },
  manageButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f8f9fa',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#007bff',
    marginTop: 8,
  },
  manageButtonText: {
    color: '#007bff',
    fontSize: 16,
    fontWeight: '600',
    marginLeft: 8,
  },
  
  // Charge Reasons Modal styles
  chargeReasonsContent: {
    flex: 1,
    paddingHorizontal: 20,
    paddingBottom: 10,
  },
  addChargeReasonSection: {
    backgroundColor: '#f8f9fa',
    padding: 16,
    borderRadius: 8,
    marginBottom: 20,
  },
  chargeReasonSectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 12,
    color: '#333',
  },
  chargeReasonInput: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 6,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
    marginBottom: 10,
  },
  darkChargeReasonInput: {
    backgroundColor: '#333',
    borderColor: '#555',
    color: '#fff',
  },
  addButton: {
    backgroundColor: '#28a745',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    borderRadius: 6,
  },
  addButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
    marginLeft: 8,
  },
  chargeReasonsListSection: {
    flex: 1,
  },
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: 40,
  },
  emptyStateText: {
    fontSize: 14,
    color: '#666',
    textAlign: 'center',
    marginTop: 12,
  },
  chargeReasonItem: {
    backgroundColor: '#fff',
    padding: 16,
    borderRadius: 8,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#eee',
    flexDirection: 'row',
    alignItems: 'center',
  },
  darkChargeReasonItem: {
    backgroundColor: '#333',
    borderColor: '#555',
  },
  chargeReasonInfo: {
    flex: 1,
  },
  chargeReasonName: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
    marginBottom: 4,
  },
  chargeReasonDescription: {
    fontSize: 14,
    color: '#666',
    fontStyle: 'italic',
  },
  chargeReasonActions: {
    flexDirection: 'row',
    gap: 8,
  },
  chargeEditButton: {
    backgroundColor: '#007bff',
    padding: 8,
    borderRadius: 4,
  },
  darkChargeEditButton: {
    backgroundColor: '#0056b3',
  },
  chargeDeleteButton: {
    backgroundColor: '#dc3545',
    padding: 8,
    borderRadius: 4,
  },
  darkChargeDeleteButton: {
    backgroundColor: '#c82333',
  },
  chargeSaveButton: {
    backgroundColor: '#28a745',
    padding: 8,
    borderRadius: 4,
  },
  darkChargeSaveButton: {
    backgroundColor: '#1e7e34',
  },
  chargeCancelButton: {
    backgroundColor: '#6c757d',
    padding: 8,
    borderRadius: 4,
  },
  darkChargeCancelButton: {
    backgroundColor: '#545b62',
  },
  initializeButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#e3f2fd',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 6,
    marginTop: 12,
    borderWidth: 1,
    borderColor: '#007bff',
  },
  darkInitializeButton: {
    backgroundColor: '#1a3a5c',
    borderColor: '#4a90ff',
  },
  initializeButtonText: {
    color: '#007bff',
    fontSize: 14,
    fontWeight: '500',
    marginLeft: 6,
  },
  
  // Charge Modal styles (larger than QR modal)
  chargeModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  chargeModalContainer: {
    backgroundColor: '#fff',
    borderRadius: 12,
    width: '100%',
    height: '90%',
    maxWidth: 600,
    maxHeight: 800,
  },
  darkChargeModalContainer: {
    backgroundColor: '#2a2a2a',
  },
  chargeModalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 20,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  chargeModalTitle: {
    fontSize: 20,
    fontWeight: '600',
    color: '#333',
    flex: 1,
  },
  chargeModalContent: {
    padding: 20,
  },
  centerContent: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  loadingText: {
    fontSize: 16,
    color: '#666',
  },
  staffDescription: {
    fontSize: 14,
    color: '#666',
    marginBottom: 20,
    lineHeight: 20,
  },
  staffItem: {
    flexDirection: 'row',
    backgroundColor: '#f8f9fa',
    borderRadius: 8,
    padding: 16,
    marginBottom: 12,
    alignItems: 'center',
  },
  darkStaffItem: {
    backgroundColor: '#3a3a3a',
  },
  staffInfo: {
    flex: 1,
  },
  staffName: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
    marginBottom: 4,
  },
  staffEmail: {
    fontSize: 14,
    color: '#666',
    marginBottom: 8,
  },
  roleContainer: {
    alignSelf: 'flex-start',
  },
  roleTag: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'uppercase',
  },
  adminRole: {
    backgroundColor: '#007bff',
    color: '#fff',
  },
  userRole: {
    backgroundColor: '#6c757d',
    color: '#fff',
  },
  darkRoleTag: {
    opacity: 0.9,
  },
  staffActions: {
    marginLeft: 12,
  },
  actionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 6,
    minWidth: 100,
    justifyContent: 'center',
  },
  promoteButton: {
    backgroundColor: '#28a745',
  },
  demoteButton: {
    backgroundColor: '#dc3545',
  },
  actionButtonText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
    marginLeft: 4,
  },
  noStaffText: {
    fontSize: 16,
    color: '#666',
    textAlign: 'center',
    fontStyle: 'italic',
  },

});