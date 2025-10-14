import React from 'react';
import { AuthProvider } from '../contexts/AuthContext';
import { ThemeProvider } from './ThemeContext';
import AuthWrapper from '../components/AuthWrapper';

export default function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <AuthWrapper />
      </AuthProvider>
    </ThemeProvider>
  );
}
