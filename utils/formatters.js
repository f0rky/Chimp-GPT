/**
 * Format bytes as human-readable text.
 * 
 * @param {number} bytes Number of bytes
 * @param {boolean} si True to use metric (SI) units, aka powers of 1000. False to use 
 *                     binary (IEC), aka powers of 1024.
 * @param {number} dp Number of decimal places to display.
 * @returns {string} Formatted string.
 */
function formatBytes(bytes, si = true, dp = 1) {
  if (bytes === 0) return '0 B';

  const thresh = si ? 1000 : 1024;
  const units = si 
    ? ['B', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB']
    : ['B', 'KiB', 'MiB', 'GiB', 'TiB', 'PiB', 'EiB', 'ZiB', 'YiB'];
  
  let i = 0;
  let size = bytes;

  while (size >= thresh && i < units.length - 1) {
    size /= thresh;
    i++;
  }

  return `${size.toFixed(dp)} ${units[i]}`;
}

/**
 * Format a number with commas as thousands separators.
 * 
 * @param {number} num The number to format
 * @returns {string} Formatted number string
 */
function formatNumber(num) {
  return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

module.exports = {
  formatBytes,
  formatNumber
};
