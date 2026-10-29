const assert = require('node:assert/strict');
const { describe, it, before, after } = require('node:test');
const fs = require('fs').promises;
const path = require('path');

// Mock Discord client
const mockClient = {
  user: {
    setAvatar: async () => {},
  },
};

// Import the PFPManager
const PFPManager = require('../../src/utils/pfpManager');

describe('PFP Manager', function () {
  let pfpManager;
  const testDir = path.join(__dirname, '..', 'test-pfp');

  // Create a test image buffer
  // Valid 1x1 PNG; these tests exercise file rotation, not image rendering.
  const createTestImage = () =>
    Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aH1sAAAAASUVORK5CYII=',
      'base64'
    );

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
    assert.equal(typeof result, 'string');

    // Check if file exists
    const files = await fs.readdir(testDir);
    assert.equal(files.length, 1);
    assert.ok(files[0].includes(filename));
  });

  it('should respect max images limit', async () => {
    // Add 3 more images (total 4, but max is 3)
    for (let i = 2; i <= 4; i++) {
      const imageBuffer = await createTestImage();
      await pfpManager.addImage(imageBuffer, `test-image-${i}`);
    }

    // Should only keep the 3 most recent images
    const files = await fs.readdir(testDir);
    assert.equal(files.length, 3);
  });

  it('should get a random image', async () => {
    const imagePath = await pfpManager.getRandomImage();
    assert.equal(typeof imagePath, 'string');
    assert.ok(imagePath.includes(testDir));

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
    assert.equal(avatarUpdated, true);
  });
});
