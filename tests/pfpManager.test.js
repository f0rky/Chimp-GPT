const { expect } = require('chai');
const fs = require('fs').promises;
const path = require('path');
const { createCanvas } = require('canvas');

// Mock Discord client
const mockClient = {
  user: {
    setAvatar: async () => {},
  },
};

// Import the PFPManager
const PFPManager = require('../utils/pfpManager');

describe('PFP Manager', function () {
  this.timeout(10000); // Increase timeout for file operations

  let pfpManager;
  const testDir = path.join(__dirname, '..', 'test-pfp');

  // Create a test image buffer
  const createTestImage = async () => {
    const canvas = createCanvas(200, 200);
    const ctx = canvas.getContext('2d');

    // Draw a simple gradient
    const gradient = ctx.createLinearGradient(0, 0, 200, 200);
    gradient.addColorStop(0, 'red');
    gradient.addColorStop(1, 'blue');

    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 200, 200);

    // Add some text
    ctx.fillStyle = 'white';
    ctx.font = '20px Arial';
    ctx.fillText('Test Image', 50, 100);

    return canvas.toBuffer('image/png');
  };

  before(async () => {
    // Clean up test directory if it exists
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch (error) {
      // Ignore if directory doesn't exist
    }

    // Create a new PFP manager for testing
    pfpManager = new PFPManager(mockClient, {
      pfpDir: testDir,
      maxImages: 3, // Use a small number for testing
      rotationInterval: 1000, // 1 second for testing
    });
  });

  after(async () => {
    // Clean up after tests
    pfpManager.stopRotation();
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch (error) {
      // Ignore cleanup errors
    }
  });

  it('should add an image to the rotation', async () => {
    const imageBuffer = await createTestImage();
    const filename = 'test-image-1';

    const result = await pfpManager.addImage(imageBuffer, filename);
    expect(result).to.be.a('string');

    // Check if file exists
    const files = await fs.readdir(testDir);
    expect(files).to.have.length(1);
    expect(files[0]).to.include(filename);
  });

  it('should respect max images limit', async () => {
    // Add 3 more images (total 4, but max is 3)
    for (let i = 2; i <= 4; i++) {
      const imageBuffer = await createTestImage();
      await pfpManager.addImage(imageBuffer, `test-image-${i}`);
    }

    // Should only keep the 3 most recent images
    const files = await fs.readdir(testDir);
    expect(files).to.have.length(3);
  });

  it('should get a random image', async () => {
    const imagePath = await pfpManager.getRandomImage();
    expect(imagePath).to.be.a('string');
    expect(imagePath).to.include(testDir);

    // Verify the file exists
    await fs.access(imagePath);
  });

  it('should update bot avatar when rotation is active', async () => {
    let avatarUpdated = false;

    // Mock the setAvatar method
    mockClient.user.setAvatar = async buffer => {
      avatarUpdated = true;
      return { id: 'test-avatar' };
    };

    // Start rotation with a short interval
    pfpManager.startRotation();

    // Wait for the first rotation to complete
    await new Promise(resolve => setTimeout(resolve, 1500));

    // Stop rotation
    pfpManager.stopRotation();

    // Check if avatar was updated
    expect(avatarUpdated).to.be.true;
  });
});
