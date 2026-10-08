/**
 * Web Fetch Service for ChimpGPT Knowledge System
 *
 * Provides MCP-style web fetching capabilities for documentation and specific URLs.
 * Includes content parsing, sanitization, and markdown conversion.
 */

const axios = require('axios');
const { createLogger } = require('../core/logger');
const retryWithBreaker = require('../utils/retryWithBreaker');
const { loadFragment, NON_CONTENT_ELEMENTS } = require('../utils/htmlText');

const logger = createLogger('webFetch');

// Circuit breaker configuration for web fetch
const FETCH_BREAKER_CONFIG = {
  timeout: 30000, // 30 seconds
  retryAttempts: 2,
  resetTimeout: 300000, // 5 minutes
  breakerName: 'webFetch',
};

/**
 * Fetch content from a URL with parsing and sanitization
 * @param {string} url - URL to fetch
 * @param {Object} options - Fetch options
 * @param {string} options.userAgent - Custom user agent
 * @param {number} options.maxSize - Maximum response size in bytes (default: 500KB)
 * @param {boolean} options.parseHtml - Whether to parse HTML content (default: true)
 * @param {Array<string>} options.allowedDomains - Whitelist of allowed domains
 * @returns {Promise<Object>} Fetched content with metadata
 */
async function fetchWebContent(url, options = {}) {
  const {
    userAgent = 'ChimpGPT-Bot/2.0 (Educational/Research Purpose)',
    maxSize = 500 * 1024, // 500KB
    parseHtml = true,
    allowedDomains = [],
  } = options;

  if (!url || typeof url !== 'string') {
    throw new Error('URL is required and must be a string');
  }

  // Validate URL format
  let parsedUrl;
  try {
    parsedUrl = new URL(url);
  } catch (error) {
    throw new Error(`Invalid URL format: ${url}`);
  }

  // Check domain whitelist if provided
  if (allowedDomains.length > 0 && !allowedDomains.includes(parsedUrl.hostname)) {
    throw new Error(`Domain not allowed: ${parsedUrl.hostname}`);
  }

  // Security checks
  if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
    throw new Error(`Unsupported protocol: ${parsedUrl.protocol}`);
  }

  logger.info(`Fetching web content from: ${url}`);

  const fetchFunction = async () => {
    try {
      const response = await axios.get(url, {
        timeout: 25000,
        maxContentLength: maxSize,
        maxBodyLength: maxSize,
        headers: {
          'User-Agent': userAgent,
          Accept: 'text/html,text/plain,application/json,application/xml,*/*',
          'Accept-Language': 'en-US,en;q=0.9',
          'Accept-Encoding': 'gzip, deflate',
        },
        validateStatus: status => status >= 200 && status < 300,
      });

      const contentType = response.headers['content-type'] || '';
      const content = response.data;

      let parsedContent = {
        raw: content,
        text: null,
        title: null,
        description: null,
        markdown: null,
        links: [],
        images: [],
      };

      // Parse HTML content if enabled and content is HTML
      if (parseHtml && contentType.includes('text/html')) {
        parsedContent = await parseHtmlContent(content);
      } else if (contentType.includes('text/plain')) {
        parsedContent.text = content;
        parsedContent.markdown = content;
      } else if (contentType.includes('application/json')) {
        try {
          const jsonData = typeof content === 'string' ? JSON.parse(content) : content;
          parsedContent.text = JSON.stringify(jsonData, null, 2);
          parsedContent.markdown = '```json\n' + parsedContent.text + '\n```';
        } catch (e) {
          parsedContent.text = String(content);
          parsedContent.markdown = parsedContent.text;
        }
      } else {
        parsedContent.text = String(content);
        parsedContent.markdown = parsedContent.text;
      }

      logger.info(
        `Web content fetched successfully: ${parsedContent.text?.length || 0} characters`
      );

      return {
        success: true,
        data: {
          url,
          title: parsedContent.title,
          description: parsedContent.description,
          content: parsedContent.text,
          markdown: parsedContent.markdown,
          links: parsedContent.links,
          images: parsedContent.images,
          contentType,
          size: Buffer.byteLength(String(content), 'utf8'),
          fetchedAt: new Date().toISOString(),
        },
        metadata: {
          url,
          contentType,
          size: Buffer.byteLength(String(content), 'utf8'),
          domain: parsedUrl.hostname,
          fetchTime: Date.now(),
        },
      };
    } catch (error) {
      logger.error('Web fetch error:', {
        error: error.message,
        url,
        status: error.response?.status,
        statusText: error.response?.statusText,
      });

      throw new Error(`Web fetch failed: ${error.message}`);
    }
  };

  // Execute with circuit breaker protection
  return await retryWithBreaker(fetchFunction, FETCH_BREAKER_CONFIG);
}

/**
 * Parse HTML content to extract useful information
 * @param {string} html - HTML content
 * @returns {Promise<Object>} Parsed content
 */
function toAbsoluteHttpUrl(value) {
  if (!value) return null;

  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.href : null;
  } catch {
    return null;
  }
}

async function parseHtmlContent(html) {
  const result = {
    text: null,
    title: null,
    description: null,
    markdown: null,
    links: [],
    images: [],
  };

  try {
    const $ = loadFragment(html);
    result.title = $('title').first().text().trim() || null;

    const descriptionElement = $('meta')
      .toArray()
      .find(element => $(element).attr('name')?.toLowerCase() === 'description');
    result.description = descriptionElement
      ? $(descriptionElement).attr('content')?.trim() || null
      : null;

    $('a[href]').each((_, element) => {
      const href = $(element).attr('href');
      const url = typeof href === 'string' ? toAbsoluteHttpUrl(href) : null;
      const text = $(element).text().trim();
      if (typeof url === 'string' && text.length > 0) {
        result.links.push({ url, text });
      }
    });

    $('img[src]').each((_, element) => {
      const src = $(element).attr('src');
      const url = typeof src === 'string' ? toAbsoluteHttpUrl(src) : null;
      if (typeof url === 'string') {
        result.images.push({
          url,
          alt: $(element).attr('alt') || '',
        });
      }
    });

    // This output is plain text, so discard elements whose bodies are not user-visible content.
    $(NON_CONTENT_ELEMENTS.join(',')).remove();
    let textContent = $.root().text().replace(/\s+/g, ' ').trim();

    // Limit text content size
    if (textContent.length > 5000) {
      textContent = textContent.substring(0, 5000) + '...';
    }

    result.text = textContent;

    // Create basic markdown version
    let markdown = '';
    if (result.title) {
      markdown += `# ${result.title}\n\n`;
    }
    if (result.description) {
      markdown += `${result.description}\n\n`;
    }
    markdown += result.text;

    result.markdown = markdown;
  } catch (error) {
    logger.warn({ error }, 'HTML parsing error');
    result.text = '';
    result.markdown = '';
  }

  return result;
}

/**
 * Fetch documentation from common documentation sites
 * @param {string} query - Documentation query
 * @param {string} site - Documentation site (e.g., 'github', 'stackoverflow', 'mdn')
 * @returns {Promise<Object>} Documentation results
 */
async function fetchDocumentation(query, site = 'github') {
  const docUrls = {
    github: `https://docs.github.com/en/search?query=${encodeURIComponent(query)}`,
    stackoverflow: `https://stackoverflow.com/search?q=${encodeURIComponent(query)}`,
    mdn: `https://developer.mozilla.org/en-US/search?q=${encodeURIComponent(query)}`,
    nodejs: `https://nodejs.org/api/`,
    npm: `https://www.npmjs.com/search?q=${encodeURIComponent(query)}`,
  };

  const url = docUrls[site];
  if (!url) {
    throw new Error(`Unsupported documentation site: ${site}`);
  }

  logger.info(`Fetching documentation for "${query}" from ${site}`);

  const result = await fetchWebContent(url, {
    allowedDomains: [
      'docs.github.com',
      'stackoverflow.com',
      'developer.mozilla.org',
      'nodejs.org',
      'npmjs.com',
    ],
  });

  if (result.success) {
    result.documentation = {
      query,
      site,
      title: result.data.title,
      content: result.data.content,
      links: result.data.links.slice(0, 5), // Top 5 relevant links
    };
  }

  return result;
}

/**
 * Format fetched content for Discord display
 * @param {Object} fetchResult - Fetch result object
 * @param {number} maxLength - Maximum content length to display
 * @returns {string} Formatted message
 */
function formatFetchedContent(fetchResult, maxLength = 1500) {
  if (!fetchResult.success) {
    return '❌ **Fetch Failed**\nUnable to retrieve content from the specified URL.';
  }

  const { data } = fetchResult;
  let formatted = `📄 **Content from:** ${data.url}\n\n`;

  if (data.title) {
    formatted += `**${data.title}**\n\n`;
  }

  if (data.description) {
    formatted += `*${data.description}*\n\n`;
  }

  if (data.content) {
    let content = data.content;
    if (content.length > maxLength) {
      content = content.substring(0, maxLength) + '...';
    }
    formatted += `${content}\n\n`;
  }

  // Add links if available
  if (data.links && data.links.length > 0) {
    formatted += `🔗 **Related Links:**\n`;
    data.links.slice(0, 3).forEach((link, index) => {
      formatted += `${index + 1}. [${link.text || 'Link'}](${link.url})\n`;
    });
    formatted += '\n';
  }

  formatted += `*Fetched ${data.size} bytes at ${new Date(data.fetchedAt).toLocaleTimeString()}*`;

  return formatted;
}

module.exports = {
  fetchWebContent,
  fetchDocumentation,
  formatFetchedContent,
  parseHtmlContent,
};
