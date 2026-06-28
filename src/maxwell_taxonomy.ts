// Maxwell taxonomy: categories reflect John Maxwell leadership themes.
// Primary categories have higher base weight; secondary are supportive.
// Keywords are naive seed terms; replace/expand with curated list.

export interface MaxwellCategory {
  id: string;
  name: string;
  weight: number; // base weight (primary > secondary)
  keywords: string[]; // simple OR matching, case-insensitive
  description?: string;
}

export const MAXWELL_CATEGORIES: MaxwellCategory[] = [
  {
    id: 'leadership_principles',
    name: 'Leadership Principles',
    weight: 1.0,
    keywords: ['leadership', 'leader', 'leading', 'influence'],
    description: 'Core leadership fundamentals and foundational principles.'
  },
  {
    id: 'personal_growth',
    name: 'Personal Growth',
    weight: 0.9,
    keywords: ['growth', 'develop', 'development', 'improve', 'potential'],
    description: 'Mindset, continuous improvement, potential maximization.'
  },
  {
    id: 'communication',
    name: 'Communication',
    weight: 0.7,
    keywords: ['communicate', 'communication', 'listen', 'listening', 'message'],
    description: 'Effective transmission and reception of ideas.'
  },
  {
    id: 'team_building',
    name: 'Team Building',
    weight: 0.75,
    keywords: ['team', 'collaboration', 'together', 'synergy'],
    description: 'Creating, nurturing, and empowering teams.'
  },
  {
    id: 'values_character',
    name: 'Values & Character',
    weight: 0.85,
    keywords: ['character', 'integrity', 'values', 'trust'],
    description: 'Ethics, integrity, and value-driven leadership.'
  }
];

export interface TagMatch {
  categoryId: string;
  score: number; // keyword density * base weight
}

export function tagContent(text: string): TagMatch[] {
  const lower = text.toLowerCase();
  const tokens = lower.split(/\W+/).filter(Boolean);
  const tokenCounts = new Map<string, number>();
  for (const t of tokens) tokenCounts.set(t, (tokenCounts.get(t) || 0) + 1);
  const total = tokens.length || 1;
  const matches: TagMatch[] = [];
  for (const cat of MAXWELL_CATEGORIES) {
    let hits = 0;
    for (const kw of cat.keywords) hits += tokenCounts.get(kw) || 0;
    if (hits > 0) {
      const density = hits / total; // simple proportion
      const score = density * cat.weight;
      matches.push({ categoryId: cat.id, score: Number(score.toFixed(6)) });
    }
  }
  return matches.sort((a, b) => b.score - a.score);
}
