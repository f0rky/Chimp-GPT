const fs = require('fs').promises;
const path = require('path');

// Mock logger for testing
let logger;
try {
  // Try to use the real logger if available
  logger = require('./logger');
} catch (error) {
  // Fallback to a simple console logger for testing
  logger = {
    info: (...args) => console.log('[INFO]', ...args),
    warn: (...args) => console.warn('[WARN]', ...args),
    error: (...args) => console.error('[ERROR]', ...args),
    debug: (...args) => console.debug('[DEBUG]', ...args),
  };
}

class PFPManager {
  constructor(client, options = {}) {
    this.client = client;
    this.pfpDir = options.pfpDir || path.join(__dirname, '../pfp');
    this.maxImages = options.maxImages || 50;
    this.rotationInterval = options.rotationInterval || 30 * 60 * 1000; // 30 minutes by default
    this.minUpdateInterval = options.minUpdateInterval || 30 * 60 * 1000; // 30 minutes minimum between updates
    this.rotationTimer = null;
    this.currentPfp = null;
    this.lastUpdateTime = 0; // Timestamp of last successful update
    this.lastAttemptTime = 0; // Timestamp of last attempt (successful or not)
    this.updateInProgress = false; // Flag to prevent concurrent updates

    // Ensure the directory exists
    fs.mkdir(this.pfpDir, { recursive: true }).catch(err => {
      logger.error({ error: err }, 'Failed to create PFP directory');
    });
  }

  /**
   * Add a new image to the PFP rotation
   * @param {Buffer} imageBuffer - The image buffer to add
   * @param {string} [filename] - Optional custom filename (without extension)
   * @returns {Promise<string>} The path to the saved image
   */
  async addImage(buffer, filename) {
    try {
      logger.info('Attempting to add image to PFP rotation', {
        filename,
        bufferLength: buffer.length,
        pfpDir: this.pfpDir,
      });

      // Ensure the directory exists
      await fs.mkdir(this.pfpDir, { recursive: true });
      logger.debug('PFP directory ensured', { pfpDir: this.pfpDir });

      // Add file extension if not present
      const fileExt = path.extname(filename) || '.png';
      const baseName = path.basename(filename, fileExt);
      const fullPath = path.join(this.pfpDir, `${baseName}${fileExt}`);

      logger.debug('Saving image', { fullPath, fileSize: buffer.length });

      // Save the image
      await fs.writeFile(fullPath, buffer);
      logger.info('Image saved successfully', { fullPath });

      // Clean up old images if we have too many
      await this.cleanupOldImages();

      return fullPath;
    } catch (error) {
      logger.error(
        {
          error: error.message,
          stack: error.stack,
          filename,
          pfpDir: this.pfpDir,
        },
        'Failed to add image to PFP rotation'
      );
      throw error;
    }
  }

  /**
   * Get a random image from the PFP directory
   * @returns {Promise<string|null>} Path to a random image or null if none found
   */
  async getRandomImage() {
    try {
      const files = await fs.readdir(this.pfpDir);
      const imageFiles = files.filter(file =>
        ['.png', '.jpg', '.jpeg', '.gif'].includes(path.extname(file).toLowerCase())
      );

      if (imageFiles.length === 0) return null;

      const randomIndex = Math.floor(Math.random() * imageFiles.length);
      return path.join(this.pfpDir, imageFiles[randomIndex]);
    } catch (error) {
      logger.error({ error }, 'Failed to get random PFP image');
      return null;
    }
  }

  /**
   * Update the bot's profile picture to a random image
   * @returns {Promise<boolean>} True if successful, false otherwise
   */
  /**
   * Check if enough time has passed since the last PFP update
   * @returns {boolean} True if enough time has passed, false otherwise
   */
  canUpdatePFP() {
    const now = Date.now();
    const timeSinceLastUpdate = now - this.lastUpdateTime;
    const timeSinceLastAttempt = now - this.lastAttemptTime;

    // Don't update if an update is already in progress
    if (this.updateInProgress) {
      logger.debug('Update already in progress');
      return false;
    }

    // Don't update if we've tried too recently
    if (timeSinceLastAttempt < this.minUpdateInterval) {
      logger.debug(
        `Skipping PFP update - last attempt was ${Math.floor(timeSinceLastAttempt / 1000)}s ago`
      );
      return false;
    }

    // Always allow updates if we haven't updated in a while (2x min interval)
    if (timeSinceLastUpdate > this.minUpdateInterval * 2) {
      return true;
    }

    // Otherwise, respect the minimum update interval
    return timeSinceLastUpdate >= this.minUpdateInterval;
  }

  /**
   * Update the bot's profile picture to a random image
   * @returns {Promise<{success: boolean, error?: string, ratelimited?: boolean, newAvatarURL?: string}>} Result of the update attempt
   */
  async updateBotAvatar() {
    // Check if we can update FIRST
    if (!this.canUpdatePFP()) {
      logger.debug('Skipping PFP update - rate limited by canUpdatePFP logic.');
      // The canUpdatePFP method already logs the specific reason (e.g., last attempt too recent)
      return {
        success: false,
        error: 'Update not allowed at this time (check logs for reason).',
        ratelimited: true,
      };
    }

    // If canUpdatePFP passed, NOW we mark an attempt and proceed.
    this.lastAttemptTime = Date.now();
    this.updateInProgress = true;

    try {
      const imagePath = await this.getRandomImage();
      if (!imagePath) {
        logger.warn('No images available for PFP rotation');
        return { success: false, error: 'No images available for rotation.' };
      }

      if (this.currentPfp === imagePath) {
        logger.debug('Skipping PFP update (image is same as current)');
        return { success: false, error: 'Selected image is the same as current PFP.' };
      }

      logger.debug('Reading image file', { imagePath });
      const imageBuffer = await fs.readFile(imagePath);

      logger.debug('Setting bot avatar', {
        imageSize: imageBuffer.length,
        filename: path.basename(imagePath),
      });

      await this.client.user.setAvatar(imageBuffer);

      this.currentPfp = imagePath;
      this.lastUpdateTime = Date.now(); // Mark successful update time

      logger.info(`Updated bot PFP to: ${path.basename(imagePath)}`);
      return { success: true, newAvatarURL: imagePath }; // Assuming imagePath can be somewhat representative
    } catch (error) {
      let errorMessage = 'Failed to update PFP.';
      let ratelimited = false;
      if (error.code === 50035) {
        errorMessage = 'Cannot update PFP: Bot is in 100+ servers.';
        logger.warn(errorMessage);
      } else if (error.code === 'AVATAR_RATE_LIMIT' || error.retryAfter) {
        const retryAfter = error.retryAfter || 30 * 60 * 1000;
        errorMessage = `Rate limited by Discord. Try again in ${Math.ceil(retryAfter / 60000)} minutes.`;
        logger.warn(errorMessage);
        // Adjust lastUpdateTime to effectively block further attempts until retryAfter has passed
        this.lastUpdateTime = Date.now() - this.minUpdateInterval + retryAfter;
        ratelimited = true;
      } else {
        logger.error(
          {
            error: error.message,
            stack: error.stack,
            currentPFP: this.currentPfp,
          },
          'Failed to update PFP'
        );
        errorMessage = `An unexpected error occurred: ${error.message}`;
      }
      return { success: false, error: errorMessage, ratelimited };
    } finally {
      this.updateInProgress = false;
    }
  }

  /**
   * Remove old images to maintain the maximum limit
   */
  async cleanupOldImages() {
    try {
      const files = await fs.readdir(this.pfpDir);

      // Get file stats for all files
      const fileStats = await Promise.all(
        files
          .filter(file =>
            ['.png', '.jpg', '.jpeg', '.gif'].includes(path.extname(file).toLowerCase())
          )
          .map(async file => {
            const filePath = path.join(this.pfpDir, file);
            try {
              const stats = await fs.stat(filePath);
              return {
                name: file,
                path: filePath,
                time: stats.mtime.getTime(),
              };
            } catch (err) {
              logger.warn({ error: err, file }, 'Failed to get file stats');
              return null;
            }
          })
      );

      // Filter out any null entries and sort by time (newest first)
      const imageFiles = fileStats.filter(Boolean).sort((a, b) => b.time - a.time);

      // Remove oldest images if we're over the limit
      const toRemove = imageFiles.slice(this.maxImages);

      if (toRemove.length > 0) {
        logger.debug(`Cleaning up ${toRemove.length} old PFP images`);

        // Delete files in parallel
        await Promise.all(
          toRemove.map(async file => {
            try {
              await fs.unlink(file.path);
              logger.debug(`Removed old PFP: ${file.name}`);
            } catch (err) {
              logger.error({ error: err }, `Failed to remove old PFP: ${file.name}`);
            }
          })
        );
      }
    } catch (error) {
      logger.error({ error }, 'Failed to clean up old PFP images');
    }
  }

  /**
   * Start the automatic PFP rotation
   */
  startRotation() {
    if (this.rotationTimer) this.stopRotation();

    // Initial update if enough time has passed
    if (this.canUpdatePFP()) {
      this.updateBotAvatar().catch(() => {});
    } else {
      const nextUpdate = Math.ceil(
        (this.lastUpdateTime + this.minUpdateInterval - Date.now()) / 60000
      );
      logger.info(`Next PFP update in ${nextUpdate} minutes`);
    }

    // Set up the rotation interval
    this.rotationTimer = setInterval(
      () => {
        if (this.canUpdatePFP()) {
          this.updateBotAvatar().catch(() => {});
        }
      },
      Math.max(this.minUpdateInterval, 60000)
    ); // Check at least once per minute

    logger.info(
      `Started PFP rotation (checking every minute, updating every ${Math.ceil(this.minUpdateInterval / 60000)}-${Math.ceil(this.rotationInterval / 60000)} minutes)`
    );
  }

  /**
   * Stop the automatic PFP rotation
   */
  stopRotation() {
    if (this.rotationTimer) {
      clearInterval(this.rotationTimer);
      this.rotationTimer = null;
      logger.info('Stopped PFP rotation');
    }
  }
}

module.exports = PFPManager;
