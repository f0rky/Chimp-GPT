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
    debug: (...args) => console.debug('[DEBUG]', ...args)
  };
}

class PFPManager {
    constructor(client, options = {}) {
        this.client = client;
        this.pfpDir = options.pfpDir || path.join(__dirname, '../pfp');
        this.maxImages = options.maxImages || 50;
        this.rotationInterval = options.rotationInterval || 10 * 60 * 1000; // 10 minutes
        this.rotationTimer = null;
        this.currentPfp = null;
        
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
                pfpDir: this.pfpDir 
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
            logger.error({ 
                error: error.message,
                stack: error.stack,
                filename,
                pfpDir: this.pfpDir 
            }, 'Failed to add image to PFP rotation');
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
    async updateBotAvatar() {
        try {
            async function updatePFP() {
                try {
                    logger.debug('Starting PFP update');
                    
                    const imagePath = await this.getRandomImage();
                    if (!imagePath) {
                        logger.warn('No images available for PFP rotation');
                        return;
                    }
                    
                    // Skip if this is the same as the current PFP
                    if (this.currentPfp === imagePath) {
                        logger.debug('Skipping PFP update (same as current)');
                        return;
                    }
                    
                    logger.debug('Reading image file', { imagePath });
                    const imageBuffer = await fs.readFile(imagePath);
                    
                    logger.debug('Setting bot avatar', { 
                        imageSize: imageBuffer.length,
                        filename: path.basename(imagePath) 
                    });
                    
                    await this.client.user.setAvatar(imageBuffer);
                    this.currentPfp = imagePath;
                    
                    logger.info(`Updated bot PFP to: ${path.basename(imagePath)}`);
                    return true;
                } catch (error) {
                    logger.error({ 
                        error: error.message,
                        stack: error.stack,
                        currentPFP: this.currentPfp
                    }, 'Failed to update PFP');
                    throw error;
                }
            }
            return await updatePFP.call(this);
        } catch (error) {
            if (error.code === 50035) {
                logger.warn('Cannot update PFP: Bot is in 100+ servers');
            } else if (error.retryAfter) {
                logger.warn(`Rate limited. Try again in ${error.retryAfter}ms`);
            } else {
                logger.error({ error }, 'Failed to update bot PFP');
            }
            return false;
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
                    .map(async (file) => {
                        const filePath = path.join(this.pfpDir, file);
                        try {
                            const stats = await fs.stat(filePath);
                            return {
                                name: file,
                                path: filePath,
                                time: stats.mtime.getTime()
                            };
                        } catch (err) {
                            logger.warn({ error: err, file }, 'Failed to get file stats');
                            return null;
                        }
                    })
            );

            // Filter out any null entries and sort by time (newest first)
            const imageFiles = fileStats
                .filter(Boolean)
                .sort((a, b) => b.time - a.time);

            // Remove oldest images if we're over the limit
            const toRemove = imageFiles.slice(this.maxImages);
            
            if (toRemove.length > 0) {
                logger.debug(`Cleaning up ${toRemove.length} old PFP images`);
                
                // Delete files in parallel
                await Promise.all(
                    toRemove.map(async (file) => {
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
        
        // Initial update
        this.updateBotAvatar().catch(() => {});
        
        // Set up the rotation interval
        this.rotationTimer = setInterval(
            () => this.updateBotAvatar().catch(() => {}),
            this.rotationInterval
        );
        
        logger.info(`Started PFP rotation (every ${this.rotationInterval / 60000} minutes)`);
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
