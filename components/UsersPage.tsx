import React, { useState, useEffect } from 'react';
import { View, TextInput, FlatList, Text, StyleSheet, Dimensions, TouchableOpacity, Alert } from 'react-native';
import { useTheme } from '../app/ThemeContext';
import { MaterialIcons } from '@expo/vector-icons';
import { hybridSyncService } from '../services/HybridSyncService';
import { Player } from '../services/FirebaseService';

const { width } = Dimensions.get('window');

// Backward compatibility interface
interface User {
    name: string;
    id?: string;
}

export default function UsersPage() {
    const [users, setUsers] = useState<User[]>([]);
    const [name, setName] = useState<string>('');
    const [loading, setLoading] = useState(false);
    // Submission state tracking to prevent duplicates during poor signal
    const [isSubmittingPlayer, setIsSubmittingPlayer] = useState(false);
    const { isDarkMode } = useTheme();

    const loadUsers = async () => {
        try {
            setLoading(true);
            console.log('📱 UsersPage: Loading players via HybridSyncService (fixed from getUsers)');
            
            // Check network and cache status for debugging
            const isOnline = await hybridSyncService.refreshNetworkState();
            console.log('📱 UsersPage: Network status:', isOnline ? 'Online' : 'Offline');
            
            // Use getPlayers() instead of getUsers() for proper player data
            const playersData = await hybridSyncService.getPlayersWithOverlay(); // Use overlay to show provisional balance changes
            const userList = playersData.map((player: Player) => ({
                id: player.id || `player_${player.name}`,
                name: player.name || `${player.firstName} ${player.lastName}` || 'Unknown Player'
            }));
            
            console.log('📱 UsersPage: Loaded players:', { count: userList.length, players: userList });
            setUsers(userList);
        } catch (error) {
            console.error('❌ UsersPage: Error loading players:', error);
            Alert.alert('Error', 'Failed to load players');
        } finally {
            setLoading(false);
        }
    };

    const addUser = async () => {
        // Prevent multiple submissions during poor signal
        if (isSubmittingPlayer) {
            console.log('UsersPage: Player submission already in progress, ignoring duplicate click');
            return;
        }

        if (name.trim()) {
            // Set submission state immediately to prevent duplicates
            setIsSubmittingPlayer(true);
            
            try {
                console.log('📱 UsersPage: Adding player via HybridSyncService (offline-first)');
                
                // Offline-first: Add player optimistically to UI immediately
                const tempPlayer = { 
                    id: `temp_${Date.now()}`, 
                    name: name.trim() 
                };
                setUsers(prev => [...prev, tempPlayer]);
                
                // Use addPlayer instead of addUser for proper player creation
                await hybridSyncService.addPlayer({ name: name.trim() });
                setName('');
                await loadUsers(); // Reload to get the final state from sync
                Alert.alert('Success', 'Player added successfully');
            } catch (error) {
                console.error('❌ UsersPage: Error adding player:', error);
                Alert.alert('Error', 'Failed to add player');
            } finally {
                // Always reset submission state
                setIsSubmittingPlayer(false);
            }
        }
    };

    const confirmDeleteUser = (user: User, index: number) => {
        Alert.alert(
            'Delete Player',
            'Deleting this player will remove all of their transaction history, are you sure?',
            [
                { text: 'Cancel', style: 'cancel' },
                { text: 'Delete', style: 'destructive', onPress: () => deleteUser(user) },
            ],
            { cancelable: true }
        );
    };

    const deleteUser = async (user: User) => {
        try {
            console.log('📱 UsersPage: Deleting player via HybridSyncService');
            // Use deletePlayer instead of deleteUser with proper player ID
            if (user.id) {
                await hybridSyncService.deletePlayer(user.id);
            } else {
                console.warn('⚠️ UsersPage: No player ID for deletion, skipping');
                Alert.alert('Error', 'Cannot delete player: missing ID');
                return;
            }
            await loadUsers(); // Reload the list
            Alert.alert('Success', 'Player deleted successfully');
        } catch (error) {
            console.error('❌ UsersPage: Error deleting player:', error);
            Alert.alert('Error', 'Failed to delete player');
        }
    };

    useEffect(() => {
        loadUsers();
    }, []);

    return (
        <View style={[styles.container, isDarkMode && styles.darkContainer]}>
            <TextInput
                style={[styles.input, isDarkMode && styles.darkInput]}
                placeholder="Enter Player Name"
                value={name}
                onChangeText={setName}
            />
            <TouchableOpacity 
                style={[
                    styles.addButton, 
                    isDarkMode && styles.darkAddButton,
                    isSubmittingPlayer && { opacity: 0.6, backgroundColor: '#ccc' }
                ]} 
                onPress={addUser}
                disabled={isSubmittingPlayer}
            >
                <Text style={[styles.addButtonText, isDarkMode && styles.darkAddButtonText]}>
                    {isSubmittingPlayer ? 'Adding...' : 'Add Player'}
                </Text>
            </TouchableOpacity>
            <FlatList
                data={users}
                renderItem={({ item, index }) => (
                    <View style={styles.userRow}>
                        <Text style={[styles.userText, isDarkMode && styles.darkUserText]}>{item.name}</Text>
                        <TouchableOpacity onPress={() => confirmDeleteUser(item, index)}>
                            <MaterialIcons
                                name="delete"
                                size={24}
                                color={isDarkMode ? '#fff' : '#ff0000'}
                                style={styles.deleteIcon}
                            />
                        </TouchableOpacity>
                    </View>
                )}
                keyExtractor={(item) => item.id || item.name}
            />
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        padding: width > 600 ? 40 : 20, // Adjust padding based on screen width
        backgroundColor: '#fff',
    },
    darkContainer: {
        backgroundColor: '#1a1a1a',
    },
    input: {
        borderWidth: 1,
        borderColor: '#ccc',
        padding: 10,
        marginBottom: 10,
        borderRadius: 5,
    },
    darkInput: {
        backgroundColor: '#333',
        borderColor: '#555',
        color: '#fff',
    },
    addButton: {
        backgroundColor: '#007bff',
        paddingVertical: 10,
        paddingHorizontal: 20,
        borderRadius: 5,
        alignItems: 'center',
        marginBottom: 20,
    },
    darkAddButton: {
        backgroundColor: '#0066cc',
    },
    addButtonText: {
        color: '#fff',
        fontWeight: 'bold',
        fontSize: 16,
    },
    darkAddButtonText: {
        color: '#fff',
    },
    userRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: 10,
        borderBottomWidth: 1,
        borderBottomColor: '#eee',
    },
    userText: {
        fontSize: width > 600 ? 18 : 16, // Adjust font size based on screen width
    },
    darkUserText: {
        color: '#fff',
    },
    deleteIcon: {
        marginLeft: 10,
    },
});
