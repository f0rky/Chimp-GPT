'use strict';

// Flatten only visible embed content for assertions that are not description-specific.
module.exports = embed =>
  [embed.description, ...(embed.fields || []).flatMap(field => [field.name, field.value])]
    .filter(Boolean)
    .join('\n');
