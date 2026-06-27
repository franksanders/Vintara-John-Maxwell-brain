// Maxwell taxonomy: categories reflect John Maxwell's core leadership themes.
// Primary categories (weight >= 0.85) are central to his teaching.
// Secondary categories provide important supporting themes.
// Keywords are seed terms for naive OR matching; expand with curated lists.

export interface MaxwellCategory {
  id: string;
  name: string;
  weight: number;
  keywords: string[];
  description?: string;
}

export const MAXWELL_CATEGORIES: MaxwellCategory[] = [
  // --- Primary ---
  {
    id: 'leadership_principles',
    name: 'Leadership Principles',
    weight: 1.0,
    keywords: [
      'leadership', 'leader', 'leading', 'lead', 'influence', 'influencer',
      'law of leadership', '21 laws', 'level of leadership', '5 levels',
      'everything rises', 'falls on leadership', 'lid', 'law of the lid',
    ],
    description: 'Core leadership fundamentals and foundational principles.',
  },
  {
    id: 'personal_growth',
    name: 'Personal Growth',
    weight: 0.95,
    keywords: [
      'growth', 'grow', 'develop', 'development', 'improve', 'improvement',
      'potential', 'maximize', 'become', 'better', 'best', 'invest in yourself',
      'compound', 'daily disciplines', 'today matters', 'intentional',
      'intentional living', 'lifelong learning', 'leaders are learners',
    ],
    description: 'Mindset, continuous improvement, and potential maximization.',
  },
  {
    id: 'values_character',
    name: 'Values & Character',
    weight: 0.90,
    keywords: [
      'character', 'integrity', 'values', 'value', 'trust', 'trustworthy',
      'authentic', 'authenticity', 'ethics', 'honest', 'honesty',
      'credibility', 'consistency', 'moral', 'principle', 'foundation',
    ],
    description: 'Ethics, integrity, and value-driven leadership.',
  },
  {
    id: 'influence',
    name: 'Influence',
    weight: 0.90,
    keywords: [
      'influence', 'inspire', 'inspires', 'inspiring', 'motivation', 'motivate',
      'encourage', 'encouragement', 'impact', 'move people', 'persuade',
      'connect', 'connection', 'relationship', 'rapport', 'buy in',
      'win people', 'inner circle', 'law of the inner circle',
    ],
    description: 'Building relationships and moving people through genuine connection.',
  },

  // --- Strong Secondary ---
  {
    id: 'servant_leadership',
    name: 'Servant Leadership',
    weight: 0.85,
    keywords: [
      'serve', 'servant', 'serving', 'others first', 'add value',
      'invest in people', 'people development', 'develop others',
      'lift others', 'empowerment', 'empower', 'equip', 'equipping',
      'give back', 'legacy', 'level 4', 'level 5', 'pinnacle',
    ],
    description: 'Serving, developing, and empowering others.',
  },
  {
    id: 'vision',
    name: 'Vision',
    weight: 0.85,
    keywords: [
      'vision', 'purpose', 'direction', 'destination', 'dream', 'future',
      'clarity', 'clarity of vision', 'see', 'big picture', 'north star',
      'mission', 'goal', 'goals', 'strategic', 'strategy',
      'where are we going', 'why we exist',
    ],
    description: 'Painting a compelling picture of where you are headed.',
  },
  {
    id: 'communication',
    name: 'Communication',
    weight: 0.80,
    keywords: [
      'communicate', 'communication', 'listen', 'listening', 'message',
      'speak', 'speaking', 'storytelling', 'story', 'connect', 'ask',
      'question', 'feedback', 'dialogue', 'conversation', 'talk',
      'understand', 'clarity', 'articulate',
    ],
    description: 'Effective transmission and reception of ideas.',
  },

  // --- Supporting ---
  {
    id: 'team_building',
    name: 'Team Building',
    weight: 0.75,
    keywords: [
      'team', 'collaboration', 'together', 'synergy', 'culture', 'trust',
      'build a team', 'hire', 'people', 'talent', 'chemistry',
      'right people', 'wrong people', 'alignment', 'accountability',
    ],
    description: 'Creating, nurturing, and empowering high-performing teams.',
  },
  {
    id: 'failure_resilience',
    name: 'Failure & Resilience',
    weight: 0.75,
    keywords: [
      'fail', 'failure', 'failing', 'bounce back', 'setback', 'mistake',
      'learn from failure', 'recover', 'resilience', 'resilient',
      'persevere', 'perseverance', 'grit', 'never give up', 'comeback',
      'obstacle', 'adversity', 'challenge', 'difficult', 'hard',
    ],
    description: 'Learning from failure and bouncing back stronger.',
  },
  {
    id: 'intentional_living',
    name: 'Intentional Living',
    weight: 0.75,
    keywords: [
      'intentional', 'intentionality', 'daily', 'discipline', 'habits',
      'choices', 'today matters', 'routine', 'consistency', 'deliberate',
      'on purpose', 'plan', 'prioritize', 'priority', 'time', 'focus',
      'manage yourself', 'self leadership',
    ],
    description: 'Deliberate daily choices that compound into a meaningful life.',
  },
  {
    id: 'attitude',
    name: 'Attitude',
    weight: 0.70,
    keywords: [
      'attitude', 'mindset', 'perspective', 'positive', 'optimism', 'outlook',
      'belief', 'believe', 'thought', 'think', 'reframe', 'choice of attitude',
      'gratitude', 'grateful', 'joy', 'enthusiasm',
    ],
    description: 'Choosing a mindset that empowers and sustains leadership.',
  },
];

export interface TagMatch {
  categoryId: string;
  score: number;
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
    for (const kw of cat.keywords) {
      // Support multi-word keywords via substring match
      if (kw.includes(' ')) {
        if (lower.includes(kw)) hits += 2; // bonus for phrase match
      } else {
        hits += tokenCounts.get(kw) || 0;
      }
    }
    if (hits > 0) {
      const density = hits / total;
      const score = density * cat.weight;
      matches.push({ categoryId: cat.id, score: Number(score.toFixed(6)) });
    }
  }
  return matches.sort((a, b) => b.score - a.score);
}
