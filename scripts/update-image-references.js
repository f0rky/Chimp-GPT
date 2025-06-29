/**
 * Script to update all references from 'dalle' to 'gptimage' in the codebase
 * This ensures consistency with the current GPT Image-1 model being used
 */

const fs = require('fs');
const path = require('path');

// Files that need to be updated
const filesToUpdate = [
  './functionResults.js',
  './healthCheck.js',
  './statusServer.js',
  './reset-data-files.js',
  './utils/demoDataGenerator.js',
  './chimpGPT.js',
];

// Count of replacements made
let totalReplacements = 0;

// Process each file
filesToUpdate.forEach(filePath => {
  const fullPath = path.resolve(__dirname, filePath);

  if (!fs.existsSync(fullPath)) {
    console.error(`File not found: ${fullPath}`);
    return;
  }

  try {
    // Read the file content
    let content = fs.readFileSync(fullPath, 'utf8');

    // Count occurrences before replacement
    const occurrencesBefore = (content.match(/dalle/g) || []).length;

    if (occurrencesBefore === 0) {
      console.log(`No occurrences of 'dalle' found in ${filePath}`);
      return;
    }

    // Replace 'dalle' with 'gptimage' in various contexts
    content = content
      // Replace property definitions in JSDoc comments
      .replace(/@property {.*?} dalle/g, '@property {$&} gptimage')
      // Replace function parameter documentation
      .replace(/(weather|time|wolfram|quake), dalle/g, '$1, gptimage')
      // Replace object property initializations
      .replace(/dalle: (\[\]|0|{[^}]*})/g, 'gptimage: $1')
      // Replace function calls and references
      .replace(/trackApiCall\('dalle'/g, "trackApiCall('gptimage'")
      .replace(/trackError\('dalle'/g, "trackError('gptimage'")
      // Replace UI element IDs and references
      .replace(/id="dalle-/g, 'id="gptimage-')
      .replace(/data-tab="dalle"/g, 'data-tab="gptimage"')
      // Replace variable references
      .replace(/apiCalls\.dalle/g, 'apiCalls.gptimage')
      .replace(/errors\.dalle/g, 'errors.gptimage')
      // Replace array references
      .replace(/\['dalle'\]/g, "['gptimage']")
      .replace(/'dalle',/g, "'gptimage',");

    // Count occurrences after replacement
    const occurrencesAfter = (content.match(/dalle/g) || []).length;
    const replacementsMade = occurrencesBefore - occurrencesAfter;

    // Update the file with new content
    fs.writeFileSync(fullPath, content, 'utf8');

    console.log(`Updated ${filePath}: ${replacementsMade} replacements made`);
    totalReplacements += replacementsMade;
  } catch (error) {
    console.error(`Error processing ${filePath}:`, error);
  }
});

// Update specific UI text references to DALL-E
try {
  const htmlPath = path.resolve(__dirname, '../src/web/public/index.html');
  if (fs.existsSync(htmlPath)) {
    let htmlContent = fs.readFileSync(htmlPath, 'utf8');

    // Replace DALL-E tab button text with GPT Image-1
    htmlContent = htmlContent.replace(
      /<button class="tab-button" data-tab="dalle">DALL-E<\/button>/,
      '<button class="tab-button" data-tab="gptimage">GPT Image-1</button>'
    );

    fs.writeFileSync(htmlPath, htmlContent, 'utf8');
    console.log('Updated HTML references from DALL-E to GPT Image-1');
  }
} catch (error) {
  console.error('Error updating HTML:', error);
}

console.log(`\nTotal replacements made: ${totalReplacements}`);
console.log('\nDone! All references from "dalle" to "gptimage" have been updated.');
