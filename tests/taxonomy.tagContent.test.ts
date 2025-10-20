import { tagContent, MAXWELL_CATEGORIES } from '../src/maxwell_taxonomy';

describe('tagContent', () => {
  it('tags text with matching categories', () => {
    const text = 'Leadership growth requires integrity and strong communication in the team.';
    const tags = tagContent(text);
    const categoryIds = tags.map(t => t.categoryId);
    expect(categoryIds).toEqual(expect.arrayContaining(['leadership_principles', 'personal_growth', 'communication', 'values_character', 'team_building']));
    // Scores should be descending
    for (let i = 1; i < tags.length; i++) {
      expect(tags[i - 1].score).toBeGreaterThanOrEqual(tags[i].score);
    }
  });

  it('returns empty for unrelated text', () => {
    const text = 'Bananas are yellow and taste sweet.';
    const tags = tagContent(text);
    expect(tags).toHaveLength(0);
  });
});
