const fs = require('fs');

// Read the file
const filePath = './services/HybridSyncService.ts';
let content = fs.readFileSync(filePath, 'utf8');

// Fix the specific syntax error around line 1527
// Remove the problematic else clause
const problematicPattern = /(\s+}\s+else\s*\{\s*console\.log\(.*Offline mode detected.*\);\s*throw new Error\(.*Offline.*\);\s*})/g;

content = content.replace(problematicPattern, '');

// Write the file back
fs.writeFileSync(filePath, content, 'utf8');
console.log('Fixed syntax error in HybridSyncService.ts');