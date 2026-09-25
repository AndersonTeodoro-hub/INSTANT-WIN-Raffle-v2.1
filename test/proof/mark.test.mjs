// The proof mark's promise: the same proof always draws the same shape, another
// proof another shape, and every strand closes on itself.
//   node --experimental-strip-types test/proof/mark.test.mjs
import assert from 'node:assert/strict';
import { bandPoint, bandStrands, markParams, markPaths, proofBytes, rimPath, uintHex } from '../../lib/proof/mark.ts';

// A made-up transaction hash, built here (no 32-byte literal in the repository: F2).
const tx = `0x${Array.from({ length: 32 }, (_, i) => ((i * 37 + 11) & 255).toString(16).padStart(2, '0')).join('')}`;
const draw = (proof) => markPaths(markParams(proofBytes(proof)), 26, 220);

assert.deepEqual(draw(tx), draw(tx), 'same proof, same shape');
assert.deepEqual(draw(tx.toUpperCase().replace('0X', '0x')), draw(tx), 'case does not change the proof');
assert.notDeepEqual(draw(tx), draw(tx.slice(0, -1) + 'c'), 'one digit changes the shape');
assert.equal(rimPath(markParams(proofBytes(tx))), rimPath(markParams(proofBytes(tx))), 'same rim');

const seed = proofBytes(uintHex(5n));
assert.equal(seed.length, 32);
assert.equal(seed[31], 5, 'a uint256 seed is read as 32 bytes, big-endian');
assert.equal(uintHex(5n).length, 66);

const params = markParams(proofBytes(tx));
assert.equal(params.nibbles.length, 64, 'the rim carries every hex digit');
assert.equal(bandStrands(params, 48).reduce((sum, n) => sum + n, 0), 48, 'every strand is given to a band');
params.bands.forEach((band) => {
  for (let j = 0; j < 8; j++) {
    const a = bandPoint(band, params.tilt, j, 8, 0, 240);
    const b = bandPoint(band, params.tilt, j, 8, 239, 240);
    a.forEach((v, k) => assert.ok(Math.abs(v - b[k]) < 1e-9, 'each strand closes on itself'));
  }
});

console.log('proof mark: ok');
