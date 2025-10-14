const fs = require('fs');

// Read the file
const filePath = './services/HybridSyncService.ts';
let content = fs.readFileSync(filePath, 'utf8');

// Find and replace the entire addAssignment method
const startPattern = /async addAssignment\(assignment: any\): Promise<{ id: string; syncStatus: 'synced' \| 'pending' }> \{/;
const endPattern = /\s+\/\/ ============================================\s+\/\/ LOCAL DATA HELPERS\s+\/\/ ============================================/;

// Find the start and end positions
const startMatch = content.match(startPattern);
const endMatch = content.match(endPattern);

if (startMatch && endMatch) {
  const startIndex = content.indexOf(startMatch[0]);
  const endIndex = content.indexOf(endMatch[0]);
  
  if (startIndex !== -1 && endIndex !== -1) {
    // Replace the entire method
    const newMethod = `async addAssignment(assignment: any): Promise<{ id: string; syncStatus: 'synced' | 'pending' }> {
    console.log('🎯 Adding assignment via applyOp system');
    
    // Generate UUID for the assignment
    const assignmentId = generateUUID();
    const assignmentWithId = { 
      ...assignment, 
      id: assignmentId,
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
    
    try {
      // Use the unified applyOp system for both online and offline
      await this.applyOp({
        id: generateUUID(),
        type: 'create',
        collection: 'assignments',
        entityId: assignmentId,
        data: assignmentWithId,
        metadata: {
          deviceId: this.deviceId,
          timestamp: Date.now(),
          version: 1,
          vectorClock: this.createVersionVector(),
          source: 'local'
        }
      });
      
      console.log('✅ Assignment added via applyOp:', assignmentId);
      return { id: assignmentId, syncStatus: this.isOnline ? 'synced' : 'pending' };
    } catch (error) {
      console.error('❌ Error adding assignment via applyOp:', error);
      throw error;
    }
  }

  `;
  
    const before = content.substring(0, startIndex);
    const after = content.substring(endIndex);
    
    content = before + newMethod + after;
    
    // Write the file back
    fs.writeFileSync(filePath, content, 'utf8');
    console.log('Fixed addAssignment method in HybridSyncService.ts');
  } else {
    console.log('Could not find method boundaries');
  }
} else {
  console.log('Could not find method pattern');
}