import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../', import.meta.url);

function readOmfData(source) {
  let recordOffset = 0;
  const chunks = [];

  while (recordOffset < source.length) {
    const recordType = source[recordOffset];
    const recordLength = source.readUInt16LE(recordOffset + 1);
    const recordEnd = recordOffset + 3 + recordLength;
    assert.ok(recordEnd <= source.length, 'OMF record stays inside the source object');

    if (recordType === 0xa0) {
      const payloadStart = recordOffset + 3;
      assert.equal(source[payloadStart] & 0x80, 0, 'font uses a one-byte OMF segment index');
      const dataOffset = source.readUInt16LE(payloadStart + 1);
      chunks.push({ dataOffset, data: source.subarray(payloadStart + 3, recordEnd - 1) });
    }
    recordOffset = recordEnd;
  }

  const size = Math.max(...chunks.map(({ dataOffset, data }) => dataOffset + data.length));
  const data = Buffer.alloc(size);
  for (const chunk of chunks) chunk.data.copy(data, chunk.dataOffset);
  return data;
}

function glyphRows(data, gridCode) {
  const [count, width, height] = data;
  const bytesPerRow = Math.ceil(width / 8);
  const glyphIndex = gridCode + 1;
  const rows = [];

  for (let y = 0; y < height; y += 1) {
    const wordOffset = 5 + ((y * count + glyphIndex) * bytesPerRow);
    rows.push(
      Array.from({ length: width }, (_, x) => {
        if (bytesPerRow >= 3) {
          const byte = data[wordOffset + Math.floor(x / 8)];
          return String((byte >> (7 - (x % 8))) & 1);
        }

        if (bytesPerRow === 2) {
          const word = data.readUInt16BE(wordOffset);
          return String((word >> (width - 1 - x)) & 1);
        }

        return String((data[wordOffset] >> (7 - x)) & 1);
      }).join(''),
    );
  }
  return rows;
}

test('original GRiD font objects expose the recovered cell metrics', async () => {
  const expected = new Map([
    ['TB9X12.TYP', [144, 9, 12, 14, 11]],
    ['TB12X16.TYP', [222, 12, 16, 18, 15]],
    ['TB24X32.TYP', [222, 24, 32, 34, 31]],
    ['TG5X8.TYP', [154, 5, 8, 0, 0]],
  ]);

  for (const [filename, metrics] of expected) {
    const source = await readFile(new URL(`assets/fonts/source/${filename}`, root));
    assert.deepEqual([...readOmfData(source).subarray(0, 5)], metrics, filename);
  }
});

test('the original GRiD 81H rounds pointer survives conversion inputs exactly', async () => {
  const source = await readFile(new URL('assets/fonts/source/TB9X12.TYP', root));
  const rows = glyphRows(readOmfData(source), 0x81);
  assert.deepEqual(rows, [
    '010000000',
    '011000000',
    '011100000',
    '011110000',
    '011111000',
    '011111100',
    '011111000',
    '011110000',
    '011100000',
    '011000000',
    '010000000',
    '000000000',
  ]);

  for (const filename of [
    'grid-typeblock-9x12.48e03d10.woff2',
    'grid-typeblock-12x16.55dd2fe9.woff2',
    'grid-typeblock-24x32.b5aaf5a1.woff2',
    'grid-typegrid-5x8.a57a3fb3.woff2',
  ]) {
    const font = await readFile(new URL(`assets/fonts/${filename}`, root));
    assert.equal(font.subarray(0, 4).toString('ascii'), 'wOF2', filename);
  }
});

test('the 12x16 face keeps header letters inside the low twelve cell bits', async () => {
  const source = await readFile(new URL('assets/fonts/source/TB12X16.TYP', root));
  const rows = glyphRows(readOmfData(source), 'E'.codePointAt(0));

  assert.deepEqual(rows, [
    '000011111111',
    '000011111111',
    '000011000000',
    '000011000000',
    '000011000000',
    '000011000000',
    '000011111111',
    '000011111111',
    '000011000000',
    '000011000000',
    '000011000000',
    '000011000000',
    '000011111111',
    '000011111111',
    '000000000000',
    '000000000000',
  ]);
});

test('the 24x32 roundel face preserves GRiD display-order byte packing', async () => {
  const source = await readFile(new URL('assets/fonts/source/TB24X32.TYP', root));
  const rows = glyphRows(readOmfData(source), 'D'.codePointAt(0));

  assert.equal(rows[0], '111111111111111000000000');
  assert.equal(rows[8], '111100000000000011110000');
  assert.equal(rows[20], '111100000000000011110000');
  assert.equal(rows[27], '111111111111111000000000');
  assert.deepEqual(rows.slice(28), Array(4).fill('000000000000000000000000'));
});
