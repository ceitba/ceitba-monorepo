// Port of apps/api/src/test/java/org/ceitba/api/service/drive/DriveFolderUrlsTest.java
import { describe, expect, test } from 'bun:test';
import { parseDriveFolderUrl as parse } from '../../src/features/drive/logic/driveFolderUrls';

const ID = '1AbCdEfGhIjKlMnOpQrStUvWxYz_-123';

describe('DriveFolderUrlsTest', () => {
  test('parsesFolderLinks', () => {
    expect(parse(`https://drive.google.com/drive/folders/${ID}`)).toBe(ID);
    expect(parse(`https://drive.google.com/drive/folders/${ID}?usp=sharing`)).toBe(ID);
    expect(parse(`https://drive.google.com/drive/u/1/folders/${ID}?usp=drive_link`)).toBe(ID);
    expect(parse(`  drive.google.com/drive/folders/${ID}  `)).toBe(ID);
  });

  test('parsesIdQueryParameter', () => {
    expect(parse(`https://drive.google.com/open?id=${ID}`)).toBe(ID);
    expect(parse(`https://drive.google.com/open?usp=x&id=${ID}`)).toBe(ID);
  });

  test('acceptsBareIds', () => {
    expect(parse(ID)).toBe(ID);
  });

  test('rejectsEverythingElse', () => {
    expect(parse(null)).toBeNull();
    expect(parse('  ')).toBeNull();
    expect(parse('short')).toBeNull();
    expect(parse(`https://example.com/drive/folders/${ID}`)).toBeNull();
    expect(parse(`https://drive.google.com.evil.com/drive/folders/${ID}`)).toBeNull();
    expect(parse('https://drive.google.com/drive/my-drive')).toBeNull();
    expect(parse('https://drive.google.com/drive/folders/abc')).toBeNull();
    expect(parse('https://drive.google.com/open?id=<script>')).toBeNull();
    expect(parse('not a url at all with spaces')).toBeNull();
  });
});
