const { HybridSyncService } = require('./services/HybridSyncService');

// Test offline assignment creation
async function testOfflineAssignment() {
  console.log('🧪 TESTING OFFLINE ASSIGNMENT CREATION');
  
  const hybridSyncService = new HybridSyncService();
  
  try {
    // Initialize the service
    await hybridSyncService.initialize();
    
    // Force offline mode
    console.log('📵 Forcing offline mode...');
    hybridSyncService.forceOfflineMode();
    console.log('🔍 Current online status:', hybridSyncService.isOnline);
    
    // Test assignment data
    const testAssignmentData = {
      productId: 'test-product-123',
      productName: 'Test Product',
      userName: 'Test Player',
      playerId: 'test-player-456',
      quantity: 1,
      unitPrice: 5.00,
      total: 5.00,
      organizationId: 'test-org',
      notes: 'Offline test transaction'
    };
    
    console.log('📝 Creating offline assignment with data:', testAssignmentData);
    
    // First, let's create some test data in local storage
    const testProducts = [{
      id: 'test-product-123',
      name: 'Test Product',
      price: 5.00,
      stock: 10,
      category: 'Test',
      isActive: true,
      organizationId: 'test-org'
    }];
    
    const testPlayers = [{
      id: 'test-player-456',
      name: 'Test Player',
      firstName: 'Test',
      lastName: 'Player',
      balance: 0,
      totalSpent: 0,
      totalPurchases: 0,
      isActive: true,
      organizationId: 'test-org'
    }];
    
    // Save test data to local storage using the private method access
    // Since saveLocalData is private, we'll create the products and players properly
    await hybridSyncService.createEntity('products', testProducts[0]);
    await hybridSyncService.createEntity('players', testPlayers[0]);
    
    console.log('✅ Test data saved to local storage');
    
    // Now try to create the assignment
    const assignmentId = await hybridSyncService.createAssignmentTransaction(testAssignmentData);
    
    console.log('✅ Offline assignment created successfully:', assignmentId);
    
    // Check the results using public methods
    const assignments = await hybridSyncService.getAssignments();
    const products = await hybridSyncService.getProducts();
    const players = await hybridSyncService.getPlayers();
    
    console.log('📊 Final state:');
    console.log('  Assignments:', assignments.length);
    console.log('  Product stock:', products[0]?.stock);
    console.log('  Player balance:', players[0]?.balance);
    console.log('  Sync queue length:', hybridSyncService.getSyncQueueLength());
    
    if (assignments.length === 1 && products[0]?.stock === 9 && players[0]?.balance === 5) {
      console.log('🎉 OFFLINE ASSIGNMENT TEST PASSED!');
    } else {
      console.log('❌ OFFLINE ASSIGNMENT TEST FAILED!');
      console.log('Expected: 1 assignment, stock=9, balance=5');
      console.log('Actual:', {
        assignments: assignments.length,
        stock: products[0]?.stock,
        balance: players[0]?.balance
      });
    }
    
  } catch (error) {
    console.error('❌ Offline assignment test failed:', error);
    console.error('Error details:', {
      message: error.message,
      stack: error.stack
    });
  }
}

// Run the test
testOfflineAssignment();