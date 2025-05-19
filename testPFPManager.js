const fs = require('fs').promises;
const path = require('path');
const { createCanvas } = require('canvas');

// Mock Discord client
const mockClient = {
  user: {
    setAvatar: async (buffer) => {
      console.log('Avatar would be set with buffer size:', buffer.length);
      return { id: 'test-avatar' };
    }
  }
};

// Import the PFPManager
const PFPManager = require('./utils/pfpManager');

async function testPFPManager() {
  const testDir = path.join(process.cwd(), 'pfp-test');
  
  // Clean up test directory if it exists
  try {
    await fs.rm(testDir, { recursive: true, force: true });
  } catch (error) {
    // Ignore if directory doesn't exist
  }
  
  // Create a new PFP manager for testing
  const pfpManager = new PFPManager(mockClient, {
    pfpDir: testDir,
    maxImages: 5,
    rotationInterval: 1000 // 1 second for testing
  });
  
  // Create test images
  for (let i = 0; i < 3; i++) {
    const canvas = createCanvas(256, 256);
    const ctx = canvas.getContext('2d');
    
    // Create a simple image with a different color for each
    const colors = ['#FF5733', '#33FF57', '#3357FF'];
    ctx.fillStyle = colors[i % colors.length];
    ctx.fillRect(0, 0, 256, 256);
    
    // Add text to the image
    ctx.fillStyle = '#FFFFFF';
    ctx.font = '20px Arial';
    ctx.fillText(`Test Image ${i + 1}`, 50, 128);
    
    // Convert to buffer
    const buffer = canvas.toBuffer('image/png');
    
    // Add to PFP manager
    await pfpManager.addImage(buffer, `test-${i + 1}`);
    console.log(`Added test image ${i + 1} to PFP manager`);
  }
  
  // List files in the directory
  const files = await fs.readdir(testDir);
  console.log('\nFiles in PFP directory:');
  files.forEach((file, index) => {
    console.log(`${index + 1}. ${file}`);
  });
  
  // Test getting a random image
  console.log('\nTesting random image selection:');
  for (let i = 0; i < 3; i++) {
    const randomImage = await pfpManager.getRandomImage();
    console.log(`Random image ${i + 1}: ${path.basename(randomImage)}`);
  }
  
  // Test PFP rotation
  console.log('\nTesting PFP rotation (will run for 5 seconds)...');
  pfpManager.startRotation();
  
  // Stop after 5 seconds
  setTimeout(() => {
    pfpManager.stopRotation();
    console.log('\nTest complete!');
    process.exit(0);
  }, 5000);
}

testPFPManager().catch(console.error);
