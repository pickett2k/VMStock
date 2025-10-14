import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Alert,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  Image,
} from 'react-native';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../app/ThemeContext';
import { validateEmail, normalizeEmail } from '../utils/emailUtils';


export default function LoginScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [isSignUp, setIsSignUp] = useState(false);
  const [isResetPassword, setIsResetPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [emailError, setEmailError] = useState('');

  const { signIn, signUp, resetPassword } = useAuth();
  const { isDarkMode } = useTheme();

  // Email validation handler
  const handleEmailChange = (text: string) => {
    setEmail(text);
    
    // Clear previous error
    setEmailError('');
    
    // Skip validation if email is empty
    if (!text.trim()) {
      return;
    }
    
    // Validate email as user types
    const validation = validateEmail(text);
    if (!validation.isValid) {
      setEmailError(validation.error || 'Invalid email');
    }
  };

  const handleSubmit = async () => {
    // Consolidated validation with early return
    const validationError = validateInput();
    if (validationError) {
      Alert.alert('Validation Error', validationError);
      return;
    }

    setLoading(true);

    try {
      if (isResetPassword) {
        await resetPassword(email);
        Alert.alert(
          'Success', 
          'Password reset email sent! Check your inbox.',
          [{ text: 'OK', onPress: () => setIsResetPassword(false) }]
        );
      } else if (isSignUp) {
        await signUp(email, password, firstName, lastName);
        Alert.alert(
          'Success', 
          'Account created successfully! Please check your email to verify your account.',
          [{ text: 'OK', onPress: () => setIsSignUp(false) }]
        );
      } else {
        await signIn(email, password);
      }
    } catch (error: any) {
      console.error('Auth error:', error);
      Alert.alert('Authentication Error', error.message || 'An unexpected error occurred. Please try again.');
    } finally {
      setLoading(false);
    }
  };



  const validateInput = (): string | null => {
    if (!email.trim()) {
      return 'Please enter your email address.';
    }

    if (!password.trim() && !isResetPassword) {
      return 'Please enter your password.';
    }

    if (isSignUp && (!firstName.trim() || !lastName.trim())) {
      return 'Please enter your first and last name.';
    }

    // Basic email format validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email.trim())) {
      return 'Please enter a valid email address.';
    }

    // Password strength validation for signup
    if (isSignUp && password.length < 6) {
      return 'Password must be at least 6 characters long.';
    }

    return null;
  };

  const resetForm = () => {
    setEmail('');
    setPassword('');
    setFirstName('');
    setLastName('');
    setIsResetPassword(false);
  };

  return (
    <KeyboardAvoidingView 
      style={[styles.container, isDarkMode && styles.darkContainer]}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView contentContainerStyle={styles.scrollContainer}>
        {/* Logo */}
        <View style={styles.logoContainer}>
          <Image
            source={require('../assets/images/VM.png')}
            style={styles.logo}
            resizeMode="contain"
          />
          <Text style={[styles.title, isDarkMode && styles.darkText]}>
            StockSync
          </Text>
          <Text style={[styles.subtitle, isDarkMode && styles.darkSubtitle]}>
            Inventory Management Made Simple
          </Text>
        </View>

        {/* Form */}
        <View style={styles.formContainer}>
          <Text style={[styles.formTitle, isDarkMode && styles.darkText]}>
            {isResetPassword ? 'Reset Password' : isSignUp ? 'Create Account' : 'Sign In'}
          </Text>

          {/* Name fields (only for sign up) */}
          {isSignUp && (
            <>
              <TextInput
                style={[styles.input, isDarkMode && styles.darkInput]}
                placeholder="First Name"
                placeholderTextColor={isDarkMode ? '#aaa' : '#666'}
                value={firstName}
                onChangeText={setFirstName}
                autoCapitalize="words"
              />
              <TextInput
                style={[styles.input, isDarkMode && styles.darkInput]}
                placeholder="Last Name"
                placeholderTextColor={isDarkMode ? '#aaa' : '#666'}
                value={lastName}
                onChangeText={setLastName}
                autoCapitalize="words"
              />
            </>
          )}

          {/* Email field */}
          <TextInput
            style={[
              styles.input, 
              isDarkMode && styles.darkInput,
              emailError ? styles.inputError : null
            ]}
            placeholder="Email"
            placeholderTextColor={isDarkMode ? '#aaa' : '#666'}
            value={email}
            onChangeText={handleEmailChange}
            keyboardType="email-address"
            autoCapitalize="none"
            autoComplete="email"
          />
          
          {/* Email error display */}
          {emailError ? (
            <Text style={[styles.errorText, isDarkMode && styles.darkErrorText]}>
              {emailError}
            </Text>
          ) : null}

          {/* Password field (hidden for reset password) */}
          {!isResetPassword && (
            <TextInput
              style={[styles.input, isDarkMode && styles.darkInput]}
              placeholder="Password"
              placeholderTextColor={isDarkMode ? '#aaa' : '#666'}
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              autoComplete="password"
            />
          )}

          {/* Submit button */}
          <TouchableOpacity
            style={[styles.submitButton, loading && styles.disabledButton]}
            onPress={handleSubmit}
            disabled={loading}
          >
            <Text style={styles.submitButtonText}>
              {loading ? 'Please wait...' : 
               isResetPassword ? 'Send Reset Email' :
               isSignUp ? 'Create Account' : 'Sign In'}
            </Text>
          </TouchableOpacity>

          {/* Toggle buttons */}
          <View style={styles.toggleContainer}>
            {!isResetPassword ? (
              <>
                <TouchableOpacity
                  onPress={() => {
                    setIsSignUp(!isSignUp);
                    resetForm();
                  }}
                >
                  <Text style={[styles.toggleText, isDarkMode && styles.darkToggleText]}>
                    {isSignUp ? 'Already have an account? Sign In' : "Don't have an account? Sign Up"}
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  onPress={() => setIsResetPassword(true)}
                  style={styles.forgotPasswordButton}
                >
                  <Text style={[styles.forgotPasswordText, isDarkMode && styles.darkToggleText]}>
                    Forgot Password?
                  </Text>
                </TouchableOpacity>
              </>
            ) : (
              <TouchableOpacity
                onPress={() => {
                  setIsResetPassword(false);
                  resetForm();
                }}
              >
                <Text style={[styles.toggleText, isDarkMode && styles.darkToggleText]}>
                  Back to Sign In
                </Text>
              </TouchableOpacity>
            )}
          </View>


        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  darkContainer: {
    backgroundColor: '#1a1a1a',
  },
  scrollContainer: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: 20,
  },
  logoContainer: {
    alignItems: 'center',
    marginBottom: 40,
  },
  logo: {
    width: 120,
    height: 120,
    marginBottom: 10,
  },
  title: {
    fontSize: 32,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 5,
  },
  subtitle: {
    fontSize: 16,
    color: '#666',
    textAlign: 'center',
  },
  darkText: {
    color: '#fff',
  },
  darkSubtitle: {
    color: '#aaa',
  },
  formContainer: {
    backgroundColor: '#fff',
    padding: 25,
    borderRadius: 15,
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
    elevation: 5,
  },
  formTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    textAlign: 'center',
    marginBottom: 25,
    color: '#333',
  },
  input: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    padding: 15,
    marginBottom: 15,
    fontSize: 16,
    backgroundColor: '#f9f9f9',
  },
  darkInput: {
    backgroundColor: '#333',
    borderColor: '#555',
    color: '#fff',
  },
  submitButton: {
    backgroundColor: '#007bff',
    paddingVertical: 15,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: 10,
  },
  disabledButton: {
    backgroundColor: '#ccc',
  },
  submitButtonText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: 'bold',
  },
  toggleContainer: {
    marginTop: 20,
    alignItems: 'center',
  },
  toggleText: {
    color: '#007bff',
    fontSize: 16,
    textAlign: 'center',
    marginBottom: 10,
  },
  darkToggleText: {
    color: '#4dabf7',
  },
  forgotPasswordButton: {
    marginTop: 5,
  },
  forgotPasswordText: {
    color: '#666',
    fontSize: 14,
  },
  inputError: {
    borderColor: '#dc3545',
    borderWidth: 1,
  },
  errorText: {
    color: '#dc3545',
    fontSize: 12,
    marginTop: 5,
    marginLeft: 5,
  },
  darkErrorText: {
    color: '#ff6b6b',
  },

});