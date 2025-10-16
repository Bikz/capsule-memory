export type ConversationRole = 'user' | 'assistant' | 'system';

export type ConversationEvent = {
  id?: string;
  role: ConversationRole;
  content: string;
  metadata?: {
    channel?: string;
    tags?: string[];
    explicitMemory?: boolean;
    topic?: string;
    priority?: 'low' | 'normal' | 'high';
  };
};

export type CaptureScore = {
  score: number;
  reasons: string[];
  category: 'preference' | 'fact' | 'task' | 'context' | 'other';
  recommended: boolean;
  threshold: number;
};

export type CaptureScoreOptions = {
  threshold?: number;
};

const KEYWORD_MAP: Record<CaptureScore['category'], RegExp[]> = {
  preference: [/\b(i\s*(?:do(?:n't)?|really)?\s*(?:like|love|prefer))\b/i, /\bmy\s+(?:favorite|go[-\s]?to)/i, /\bcall\s+me\b/i, /\b(?:nickname|go by)\b/i],
  fact: [/\b(?:born|birthday|anniversary)\b/i, /\b(?:serial number|account|order)\b/i, /\b(?:address|email|phone|number)\b/i],
  task: [/\b(?:remind|reminder|todo|task|follow up|schedule)\b/i, /\b(?:tomorrow|next\s+(?:week|month)|on\s+\w+day|every\s+\w+)/i],
  context: [/\bproject\b/i, /\bmeeting\b/i, /\bstatus\b/i, /\bupdate\b/i],
  other: []
};

const NEGATIVE_PATTERNS = [/\b(just\s+chatting|ignore this)\b/i, /\b(lorem ipsum|dummy text)\b/i];
const QUESTION_PATTERN = /\?\s*$/;
const EMAIL_PATTERN = /[\w.-]+@[\w.-]+/i;
const PHONE_PATTERN = /\b\+?\d{1,2}[\s-]?\(?(?:\d{3})\)?[\s-]?\d{3}[\s-]?\d{4}\b/;
const ADDRESS_PATTERN = /\b\d+\s+\w+(?:\s+(?:street|st|avenue|ave|road|rd|lane|ln|drive|dr|boulevard|blvd))\b/i;
const MEMORY_VERB_PATTERN = /\b(?:remember|note|log|save|add this|don't forget|should remember)\b/i;
const SCHEDULE_PATTERN = /\b(?:every\s+\w+day|weekly|daily|friday|monday|afternoon|morning)\b/i;

const clampScore = (value: number, min = 0, max = 1): number => Math.min(Math.max(value, min), max);
const CATEGORY_BASE_BONUS: Record<CaptureScore['category'], number> = {
  preference: 0.35,
  fact: 0.35,
  task: 0.35,
  context: 0.2,
  other: 0
};

const ROLE_BONUS: Record<ConversationRole, number> = {
  user: 0.25,
  assistant: -0.05,
  system: 0
};

const PRIORITY_BONUS: Record<string, number> = {
  high: 0.1,
  normal: 0,
  low: -0.05
};

function detectCategory(content: string): CaptureScore['category'] {
  for (const [category, patterns] of Object.entries(KEYWORD_MAP) as Array<[
    CaptureScore['category'],
    RegExp[]
  ]>) {
    if (category === 'other') {
      continue;
    }
    if (patterns.some((pattern) => pattern.test(content))) {
      return category;
    }
  }
  return 'other';
}

function calculateBaseScore(event: ConversationEvent): { score: number; reasons: string[] } {
  let score = 0;
  const reasons: string[] = [];
  const trimmed = event.content.trim();

  if (event.metadata?.explicitMemory) {
    score += 0.5;
    reasons.push('Explicit memory flag');
  }

  const category = detectCategory(trimmed);
  const categoryBonus = CATEGORY_BASE_BONUS[category];
  if (categoryBonus > 0) {
    score += categoryBonus;
    reasons.push(`Keyword match (${category})`);
  }

  const roleBonus = ROLE_BONUS[event.role] ?? 0;
  if (roleBonus !== 0) {
    score += roleBonus;
    reasons.push(roleBonus > 0 ? 'User-authored statement' : 'Assistant/system message');
  }

  if (trimmed.length >= 160) {
    score += 0.12;
    reasons.push('Very detailed statement');
  } else if (trimmed.length >= 100) {
    score += 0.08;
    reasons.push('Detailed statement');
  } else if (trimmed.length < 40) {
    score -= 0.1;
    reasons.push('Very short utterance');
  }

  if (QUESTION_PATTERN.test(trimmed)) {
    score -= 0.1;
    reasons.push('Question phrasing');
  }

  if (MEMORY_VERB_PATTERN.test(trimmed)) {
    score += 0.25;
    reasons.push('Memory verb detected');
  }

  if (/\b(?:always|never|every time)\b/i.test(trimmed)) {
    score += 0.1;
    reasons.push('Indicates a persistent preference or rule');
  }

  if (EMAIL_PATTERN.test(trimmed) || PHONE_PATTERN.test(trimmed)) {
    score += 0.2;
    reasons.push('Contains contact details');
  }

  if (ADDRESS_PATTERN.test(trimmed)) {
    score += 0.2;
    reasons.push('Contains address information');
  }

  if (SCHEDULE_PATTERN.test(trimmed)) {
    score += 0.15;
    reasons.push('Contains scheduling cues');
  }

  for (const pattern of NEGATIVE_PATTERNS) {
    if (pattern.test(trimmed)) {
      score -= 0.3;
      reasons.push('Explicit opt-out language');
      break;
    }
  }

  if (event.metadata?.priority) {
    const bonus = PRIORITY_BONUS[event.metadata.priority] ?? 0;
    if (bonus !== 0) {
      score += bonus;
      reasons.push(`Priority ${event.metadata.priority}`);
    }
  }

  if (event.metadata?.tags?.includes('memory')) {
    score += 0.1;
    reasons.push('Tagged as memory');
  }

  return { score, reasons };
}

export function scoreConversationEvent(
  event: ConversationEvent,
  options: CaptureScoreOptions = {}
): CaptureScore {
  const threshold = options.threshold ?? 0.5;
  const { score: rawScore, reasons } = calculateBaseScore(event);
  const normalizedScore = clampScore(rawScore);
  const category = detectCategory(event.content);

  return {
    score: normalizedScore,
    reasons,
    category,
    recommended: normalizedScore >= threshold,
    threshold
  };
}

export function batchScoreEvents(
  events: ConversationEvent[],
  options?: CaptureScoreOptions
): CaptureScore[] {
  return events.map((event) => scoreConversationEvent(event, options));
}
