const assert = require('assert');
const zlib = require('zlib');

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

function paeth(left, up, upLeft) {
  const estimate = left + up - upLeft;
  const leftDistance = Math.abs(estimate - left);
  const upDistance = Math.abs(estimate - up);
  const upLeftDistance = Math.abs(estimate - upLeft);
  return leftDistance <= upDistance && leftDistance <= upLeftDistance
    ? left
    : upDistance <= upLeftDistance
      ? up
      : upLeft;
}

/**
 * Detect the specific provider failure observed in production: a valid PNG
 * whose RGB pixels are all zero. Unsupported formats intentionally return
 * `inspectable: false` rather than being rejected.
 */
function inspectPngPixels(buffer) {
  if (!Buffer.isBuffer(buffer) || !buffer.subarray(0, 8).equals(PNG_SIGNATURE)) {
    return { inspectable: false, uniformBlack: false, reason: 'not a PNG' };
  }

  let offset = 8;
  let width;
  let height;
  let colorType;
  let bitDepth;
  const idat = [];
  while (offset + 12 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.subarray(offset + 4, offset + 8).toString('ascii');
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    if (dataEnd + 4 > buffer.length)
      return { inspectable: false, uniformBlack: false, reason: 'truncated PNG' };
    const data = buffer.subarray(dataStart, dataEnd);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
    } else if (type === 'IDAT') {
      idat.push(data);
    } else if (type === 'IEND') break;
    offset = dataEnd + 4;
  }

  const bytesPerPixel = colorType === 2 ? 3 : colorType === 6 ? 4 : 0;
  if (!width || !height || bitDepth !== 8 || !bytesPerPixel || !idat.length) {
    return { inspectable: false, uniformBlack: false, reason: 'unsupported PNG encoding' };
  }

  let raw;
  try {
    raw = zlib.inflateSync(Buffer.concat(idat));
  } catch {
    return { inspectable: false, uniformBlack: false, reason: 'invalid PNG compression' };
  }

  const rowLength = width * bytesPerPixel;
  let sourceOffset = 0;
  let previous = Buffer.alloc(rowLength);
  for (let row = 0; row < height; row += 1) {
    const filter = raw[sourceOffset++];
    const current = Buffer.alloc(rowLength);
    for (let i = 0; i < rowLength; i += 1) {
      const source = raw[sourceOffset++];
      const left = i >= bytesPerPixel ? current[i - bytesPerPixel] : 0;
      const up = previous[i];
      const upLeft = i >= bytesPerPixel ? previous[i - bytesPerPixel] : 0;
      if (filter === 0) current[i] = source;
      else if (filter === 1) current[i] = (source + left) & 0xff;
      else if (filter === 2) current[i] = (source + up) & 0xff;
      else if (filter === 3) current[i] = (source + Math.floor((left + up) / 2)) & 0xff;
      else if (filter === 4) current[i] = (source + paeth(left, up, upLeft)) & 0xff;
      else return { inspectable: false, uniformBlack: false, reason: 'unsupported PNG filter' };
    }
    for (let pixel = 0; pixel < rowLength; pixel += bytesPerPixel) {
      if (current[pixel] || current[pixel + 1] || current[pixel + 2]) {
        return { inspectable: true, uniformBlack: false, reason: 'non-black pixels found' };
      }
    }
    previous = current;
  }
  return { inspectable: true, uniformBlack: true, reason: 'all RGB pixels are zero' };
}

function makeRgbPng(rgb) {
  const chunk = (type, data) => {
    const result = Buffer.alloc(12 + data.length);
    result.writeUInt32BE(data.length, 0);
    result.write(type, 4, 4, 'ascii');
    data.copy(result, 8);
    return result;
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(1, 0);
  ihdr.writeUInt32BE(1, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([
    PNG_SIGNATURE,
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(Buffer.from([0, ...rgb]))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function selftest() {
  assert.strictEqual(inspectPngPixels(makeRgbPng([0, 0, 0])).uniformBlack, true);
  assert.strictEqual(inspectPngPixels(makeRgbPng([0, 5, 0])).uniformBlack, false);
  assert.strictEqual(inspectPngPixels(Buffer.from('not an image')).inspectable, false);
  console.log(
    'SELFTEST PASS: uniform-black PNG responses are detected without rejecting other formats'
  );
}

if (require.main === module && process.argv.includes('--selftest')) {
  try {
    selftest();
    process.exit(0);
  } catch (error) {
    console.error(`SELFTEST FAIL: ${error.stack || error.message}`);
    process.exit(1);
  }
}

module.exports = { inspectPngPixels };
