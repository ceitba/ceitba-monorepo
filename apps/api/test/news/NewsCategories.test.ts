// Port of apps/api/src/test/java/org/ceitba/api/domain/news/NewsCategoriesTest.java
import { describe, expect, test } from 'bun:test';
import {
  isNewsCategory, NEWS_CATEGORIES, NEWS_CATEGORY_MESSAGE, NEWS_CATEGORY_PATTERN,
} from '../../src/features/news/logic/newsCategories';

describe('NewsCategoriesTest', () => {
  test('patternAndMessageListExactlyTheCanonicalValues', () => {
    expect(NEWS_CATEGORY_PATTERN).toBe(NEWS_CATEGORIES.join('|'));
    expect(NEWS_CATEGORY_MESSAGE).toBe(`must be one of ${NEWS_CATEGORIES.join(', ')}`);
  });

  test('patternIsCaseSensitive', () => {
    expect(isNewsCategory('Académico')).toBe(true);
    expect(isNewsCategory('ACADÉMICO')).toBe(false);
    expect(isNewsCategory('academico')).toBe(false);
  });
});
