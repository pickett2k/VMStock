import { FirebaseAuth, FirebaseFirestore } from '../config/firebase';
import { createUserWithEmailAndPassword, updateProfile } from 'firebase/auth';
import { doc, setDoc, serverTimestamp } from 'firebase/firestore';

// Temporary function to create first admin user
export const createAdminUser = async () => {
  const adminEmail = 'admin@valetucker.com';
  const adminPassword = 'Admin123!'; // Change this to a secure password
  const adminName = 'Vale Madrid Admin';

  try {
    console.log('Creating admin user...');
    
    // Create the user in Firebase Auth
    const userCredential = await createUserWithEmailAndPassword(
      FirebaseAuth,
      adminEmail,
      adminPassword
    );
    
    const user = userCredential.user;
    
    // Update the user's display name
    await updateProfile(user, {
      displayName: adminName
    });
    
    // Create user profile in Firestore
    await setDoc(doc(FirebaseFirestore, 'users', user.uid), {
      uid: user.uid,
      email: adminEmail,
      displayName: adminName,
      role: 'admin',
      organizationId: 'vale-madrid-tuck-shop',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      isActive: true,
      permissions: {
        canManageProducts: true,
        canManageUsers: true,
        canViewReports: true,
        canManageAssignments: true,
        canPerformStockTake: true,
        isAdmin: true
      },
      profile: {
        firstName: 'Vale Madrid',
        lastName: 'Admin',
        department: 'Administration',
        position: 'System Administrator'
      }
    });
    
    console.log('Admin user created successfully!');
    console.log('Email:', adminEmail);
    console.log('Password:', adminPassword);
    console.log('UID:', user.uid);
    
    return {
      success: true,
      user: user,
      credentials: { email: adminEmail, password: adminPassword }
    };
    
  } catch (error: any) {
    console.error('Error creating admin user:', error);
    
    // Handle specific error cases
    if (error.code === 'auth/email-already-in-use') {
      console.log('Admin user already exists!');
      return {
        success: false,
        error: 'Admin user already exists',
        credentials: { email: adminEmail, password: adminPassword }
      };
    }
    
    return {
      success: false,
      error: error.message || 'Unknown error occurred'
    };
  }
};

// Export credentials for easy reference
export const ADMIN_CREDENTIALS = {
  email: 'admin@valetucker.com',
  password: 'Admin123!'
};