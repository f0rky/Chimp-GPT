/**
 * Streaming Buffer Utility for ChimpGPT
 *
 * This module provides utilities for handling large image buffers efficiently
 * using streaming techniques to reduce memory usage and improve performance.
 *
 * @module StreamingBuffer
 * @author Claude Code Assistant
 * @version 1.0.0
 */

const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');
const { Readable, Transform, pipeline } = require('stream');
const { promisify } = require('util');
const { createLogger } = require('../core/logger');
const { createSecureTempFile } = require('../../utils/securityUtils');

const logger = createLogger('streaming');
const pipelineAsync = promisify(pipeline);

/**
 * Configuration for streaming operations
 */
const STREAMING_CONFIG = {
  CHUNK_SIZE: 64 * 1024, // 64KB chunks for optimal memory usage
  MAX_BUFFER_SIZE: 25 * 1024 * 1024, // 25MB max buffer (Discord limit is 8MB, but leaving headroom)
  TEMP_FILE_PREFIX: 'image_stream',
  HASH_ALGORITHM: 'sha256',
};

/**
 * Convert base64 data to a readable stream
 * @param {string} base64Data - Base64 encoded data
 * @param {number} [chunkSize=STREAMING_CONFIG.CHUNK_SIZE] - Size of each chunk
 * @returns {Readable} Readable stream of binary data
 */
function base64ToStream(base64Data, chunkSize = STREAMING_CONFIG.CHUNK_SIZE) {
  if (!base64Data || typeof base64Data !== 'string') {
    throw new Error('Invalid base64 data provided');
  }

  let position = 0;
  const base64Length = base64Data.length;

  return new Readable({
    read() {
      if (position >= base64Length) {
        this.push(null); // End of stream
        return;
      }

      // Calculate chunk size in base64 terms (base64 is 4/3 the size of binary)
      const base64ChunkSize = Math.ceil((chunkSize * 4) / 3);
      const endPosition = Math.min(position + base64ChunkSize, base64Length);
      
      // Extract base64 chunk and convert to binary
      const base64Chunk = base64Data.slice(position, endPosition);
      
      try {
        const binaryChunk = Buffer.from(base64Chunk, 'base64');
        this.push(binaryChunk);
        position = endPosition;
      } catch (error) {
        this.emit('error', new Error(`Failed to decode base64 chunk: ${error.message}`));
      }
    }
  });
}

/**
 * Stream processor that validates and tracks image data
 */
class ImageStreamProcessor extends Transform {
  constructor(options = {}) {
    super(options);
    this.bytesProcessed = 0;
    this.hash = crypto.createHash(STREAMING_CONFIG.HASH_ALGORITHM);
    this.maxSize = options.maxSize || STREAMING_CONFIG.MAX_BUFFER_SIZE;
    this.validateImage = options.validateImage !== false;
    this.fileName = options.fileName || 'processed_image';
  }

  _transform(chunk, encoding, callback) {
    try {
      // Check size limits
      this.bytesProcessed += chunk.length;
      if (this.bytesProcessed > this.maxSize) {
        return callback(new Error(`Image size exceeds maximum allowed size of ${this.maxSize} bytes`));
      }

      // Update hash
      this.hash.update(chunk);

      // Basic image format validation on first chunk
      if (this.bytesProcessed === chunk.length && this.validateImage) {
        if (!this._isValidImageHeader(chunk)) {
          return callback(new Error('Invalid image format detected'));
        }
      }

      // Pass chunk through
      callback(null, chunk);
    } catch (error) {
      callback(error);
    }
  }

  _flush(callback) {
    // Log processing completion
    const finalHash = this.hash.digest('hex');
    logger.debug({
      fileName: this.fileName,
      bytesProcessed: this.bytesProcessed,
      hash: finalHash.substring(0, 16), // First 16 chars for logging
    }, 'Image stream processing completed');

    callback();
  }

  /**
   * Validate image header to ensure it's a valid image format
   * @param {Buffer} chunk - First chunk of data
   * @returns {boolean} True if valid image format
   */
  _isValidImageHeader(chunk) {
    if (chunk.length < 8) return false;

    // Check for common image format signatures
    const signatures = [
      [0x89, 0x50, 0x4E, 0x47], // PNG
      [0xFF, 0xD8, 0xFF], // JPEG
      [0x52, 0x49, 0x46, 0x46], // WEBP (starts with RIFF)
      [0x47, 0x49, 0x46], // GIF
    ];

    return signatures.some(signature => {
      return signature.every((byte, index) => chunk[index] === byte);
    });
  }

  /**
   * Get processing statistics
   * @returns {Object} Processing statistics
   */
  getStats() {
    return {
      bytesProcessed: this.bytesProcessed,
      hash: this.hash.digest('hex'),
      exceedsDiscordLimit: this.bytesProcessed > 8 * 1024 * 1024, // 8MB Discord limit
    };
  }
}

/**
 * Process base64 image data using streaming techniques
 * @param {string} base64Data - Base64 encoded image data
 * @param {Object} options - Processing options
 * @returns {Promise<Object>} Processing result with buffer and metadata
 */
async function processImageStream(base64Data, options = {}) {
  const startTime = Date.now();
  const fileName = options.fileName || `image_${Date.now()}`;
  
  try {
    // Validate input
    if (!base64Data || typeof base64Data !== 'string') {
      throw new Error('Invalid base64 data provided');
    }

    // Estimate final size (base64 is ~33% larger than binary)
    const estimatedSize = (base64Data.length * 3) / 4;
    logger.debug({
      fileName,
      base64Length: base64Data.length,
      estimatedSize,
      estimatedSizeMB: (estimatedSize / 1024 / 1024).toFixed(2),
    }, 'Starting image stream processing');

    // Check if we need to use streaming (for large images) or can process in memory
    if (estimatedSize <= STREAMING_CONFIG.CHUNK_SIZE * 2) {
      // Small image - process directly in memory for efficiency
      logger.debug({ fileName, estimatedSize }, 'Using direct processing for small image');
      
      const buffer = Buffer.from(base64Data, 'base64');
      const hash = crypto.createHash(STREAMING_CONFIG.HASH_ALGORITHM).update(buffer).digest('hex');
      
      return {
        success: true,
        buffer,
        size: buffer.length,
        hash: hash.substring(0, 16),
        processingTime: Date.now() - startTime,
        method: 'direct',
        exceedsDiscordLimit: buffer.length > 8 * 1024 * 1024,
      };
    }

    // Large image - use streaming approach
    logger.debug({ fileName, estimatedSize }, 'Using streaming processing for large image');

    // Create temporary file for streaming
    const tempFilePath = await createSecureTempFile(STREAMING_CONFIG.TEMP_FILE_PREFIX, '.tmp');
    
    // Create streams
    const sourceStream = base64ToStream(base64Data);
    const processor = new ImageStreamProcessor({ 
      fileName,
      maxSize: options.maxSize || STREAMING_CONFIG.MAX_BUFFER_SIZE,
      validateImage: options.validateImage !== false,
    });
    const writeStream = require('fs').createWriteStream(tempFilePath);

    // Process the stream
    await pipelineAsync(sourceStream, processor, writeStream);

    // Read the processed file back into memory (now validated and chunked)
    const processedBuffer = await fs.readFile(tempFilePath);
    
    // Clean up temp file
    await fs.unlink(tempFilePath).catch(() => {
      // Ignore cleanup errors
    });

    // Get processing stats
    const stats = processor.getStats();
    
    const result = {
      success: true,
      buffer: processedBuffer,
      size: processedBuffer.length,
      hash: stats.hash.substring(0, 16),
      processingTime: Date.now() - startTime,
      method: 'streaming',
      exceedsDiscordLimit: stats.exceedsDiscordLimit,
      bytesProcessed: stats.bytesProcessed,
    };

    logger.info({
      fileName,
      size: result.size,
      processingTime: result.processingTime,
      method: result.method,
      exceedsDiscordLimit: result.exceedsDiscordLimit,
    }, 'Image stream processing completed successfully');

    return result;

  } catch (error) {
    logger.error({
      error,
      fileName,
      processingTime: Date.now() - startTime,
    }, 'Image stream processing failed');

    return {
      success: false,
      error: error.message,
      processingTime: Date.now() - startTime,
    };
  }
}

/**
 * Create a Discord-compatible attachment from processed image data
 * @param {Object} processedImage - Result from processImageStream
 * @param {string} [fileName] - Custom filename for the attachment
 * @param {string} [mimeType='image/png'] - MIME type for the image
 * @returns {Object} Discord attachment object
 */
function createDiscordAttachment(processedImage, fileName, mimeType = 'image/png') {
  if (!processedImage.success || !processedImage.buffer) {
    throw new Error('Invalid processed image data');
  }

  // Determine file extension from MIME type
  const extension = mimeType.includes('jpeg') ? 'jpg' 
                  : mimeType.includes('webp') ? 'webp' 
                  : 'png';

  const finalFileName = fileName || `generated_image_${Date.now()}.${extension}`;

  return {
    attachment: processedImage.buffer,
    name: finalFileName,
    contentType: mimeType,
  };
}

/**
 * Utility to check if image processing should use streaming
 * @param {string} base64Data - Base64 encoded data
 * @returns {boolean} True if streaming should be used
 */
function shouldUseStreaming(base64Data) {
  if (!base64Data) return false;
  
  const estimatedSize = (base64Data.length * 3) / 4;
  return estimatedSize > STREAMING_CONFIG.CHUNK_SIZE * 2;
}

module.exports = {
  processImageStream,
  createDiscordAttachment,
  shouldUseStreaming,
  base64ToStream,
  ImageStreamProcessor,
  STREAMING_CONFIG,
};