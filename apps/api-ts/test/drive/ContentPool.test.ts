// The content worker pool (logic/contentPool.ts) gives the same results as the
// inline code, off the main thread, with bounded concurrency.
import { describe, expect, test } from 'bun:test';
import { fakePdf, storedZip, tinyPng, utf8 } from '../../src/external/drive/fakeContent';
import { ContentPool, ContentWorkError } from '../../src/features/drive/logic/contentPool';

const DEMO_DOC = '<html><body><h1>Cinemática</h1><p>MRU: x = x0 + v t.</p><p><img src="images/image1.png"></p></body></html>';
const zip = () => storedZip([['ResumencinemTica.html', utf8(DEMO_DOC)], ['images/image1.png', tinyPng()]]);

describe('ContentPool', () => {
  for (const size of [0, 2]) {
    test(`demo Doc and PDF (${size === 0 ? 'inline' : 'workers'})`, async () => {
      const pool = new ContentPool(size);
      const r = await pool.run({ op: 'doc', zip: zip(), withoutImages: false, maxEntryBytes: 1 << 20 });
      if (r.op !== 'doc') throw new Error('doc');
      // The Java run's fingerprint of the same Doc (contract/tests/drive-sync.contract.test.ts).
      expect(r.doc.fingerprint).toBe('sha:2ae3efbeb5d36e328221c1e9c37849c8');
      expect(r.doc.html).toBe('<h1>Cinemática</h1>\n<p>MRU: x = x0 + v t.</p>\n<p><img src="/api/v1/wiki/files/__FILE__/assets/image1.png"></p>');
      expect(r.doc.text).toBe('Cinemática MRU: x = x0 + v t.');
      expect(r.doc.usedAssets).toEqual(['image1.png']);
      const p = await pool.run({ op: 'pdf', pdf: fakePdf('Vectores y escalares (1)') });
      expect(p.op === 'pdf' && p.info).toEqual({ text: 'Vectores y escalares (1)\n', pages: 1 });
      const tooLarge = await pool.run({ op: 'doc', zip: zip(), withoutImages: false, maxEntryBytes: 10 }).then(() => null, (e: unknown) => e);
      expect(tooLarge).toBeInstanceOf(ContentWorkError);
      expect((tooLarge as ContentWorkError).detail.tooLarge).toBe(true);
      const many = await Promise.all(Array.from({ length: 6 }, () => pool.run({ op: 'pdf', pdf: fakePdf('x') })));
      expect(many).toHaveLength(6);
      pool.close();
    }, 30_000);
  }
});
