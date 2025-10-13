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
  preference: [/\b(i\s*(?:do(?:n't)?|really)?\s*(?:like|love|prefer))\b/i, /\bmy\s+(?:favorite|go[-\s]?to)/i, /\bcall\s+me\b/i],
  fact: [/\b(?:born|birthday|anniversary)\b/i, /\b(?:serial number|account|order)\b/i, /\b(?:address|email|phone)\b/i],
  task: [/\b(?:remind|reminder|todo|task|follow up|schedule)\b/i, /\b(?:tomorrow|next week|on \w+day)\b/i],
  context: [/\bproject\b/i, /\bmeeting\b/i, /\bstatus\b/i],
  other: []
};

const NEGATIVE_PATTERNS = [/\b(just\s+chatting|ignore this)\b/i, /\b(lorem ipsum|dummy text)\b/i];
const QUESTION_PATTERN = /\?\s*$/;

const clampScore = (value: number, min = 0, max = 1): number => Math.min(Math.max(value, min), max);

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
  if (category !== 'other') {
    score += 0.25;
    reasons.push(`Keyword match (${category})`);
  }

  if (event.role === 'user') {
    score += 0.15;
    reasons.push('User-authored statement');
  } else if (event.role === 'assistant') {
    score -= 0.05;
    reasons.push('Assistant response (likely acknowledgement)');
  }

  if (trimmed.length >= 120) {
    score += 0.1;
    reasons.push('Detailed statement');
  } else if (trimmed.length < 40) {
    score -= 0.15;
    reasons.push('Very short utterance');
  }

  if (QUESTION_PATTERN.test(trimmed)) {
    score -= 0.1;
    reasons.push('Question phrasing');
  }

  if (/\b(?:remember|note|log|save|add this)\b/i.test(trimmed)) {
    score += 0.2;
    reasons.push('Memory verb detected');
  }

  if (/\b(?:always|never|every time)\b/i.test(trimmed)) {
    score += 0.1;
    reasons.push('Indicates a persistent preference or rule');
  }

  for (const pattern of NEGATIVE_PATTERNS) {
    if (pattern.test(trimmed)) {
      score -= 0.3;
      reasons.push('Explicit opt-out language');
      break;
    }
  }

  if (event.metadata?.priority === 'high') {
    score += 0.1;
    reasons.push('High priority metadata');
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
  const threshold = options.threshold ?? 0.6;
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
