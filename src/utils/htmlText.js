/**
 * Plain-text extraction for untrusted HTML-like input.
 *
 * These callers produce text for Discord or external APIs; they do not render
 * HTML. Use Cheerio's parser rather than regexes so malformed markup is
 * consistently interpreted before tags or unsafe element contents are removed.
 */
const cheerio = require('cheerio');

const NON_CONTENT_ELEMENTS = ['script', 'style', 'template', 'noscript'];

function loadFragment(input) {
  return cheerio.load(String(input ?? ''), { decodeEntities: false }, false);
}

/**
 * Convert HTML-like input to plain text.
 *
 * @param {string} input Untrusted HTML-like input.
 * @param {object} [options]
 * @param {boolean} [options.dropNonContent=false] Remove non-content elements
 *   and their contents instead of preserving their text.
 * @returns {string} Parsed plain text with no markup or attributes.
 */
function htmlToPlainText(input, { dropNonContent = false } = {}) {
  const $ = loadFragment(input);

  if (dropNonContent) {
    $(NON_CONTENT_ELEMENTS.join(',')).remove();
  }

  return $.root().text();
}

module.exports = {
  NON_CONTENT_ELEMENTS,
  htmlToPlainText,
  loadFragment,
};
