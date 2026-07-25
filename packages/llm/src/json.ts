/**
 * Getting JSON back out of a language model.
 *
 * Even with structured-output modes, models occasionally wrap their answer in
 * prose or a code fence, or trail a comma. A world with hundreds of agents
 * making a decision every simulated hour will hit every one of these, so the
 * parser is deliberately forgiving — and when it truly cannot recover, the
 * caller degrades to a safe default rather than stopping the simulation.
 */

export interface ParseResult<T> {
  ok: boolean;
  data: T | null;
  /** How the value was recovered — useful when debugging a flaky provider. */
  via: 'direct' | 'fence' | 'slice' | 'repaired' | 'failed';
}

export function parseJson<T = unknown>(raw: string): ParseResult<T> {
  const text = raw.trim();
  if (text === '') return { ok: false, data: null, via: 'failed' };

  const direct = attempt<T>(text);
  if (direct !== undefined) return { ok: true, data: direct, via: 'direct' };

  // ```json … ```
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) {
    const parsed = attempt<T>(fenced[1].trim());
    if (parsed !== undefined) return { ok: true, data: parsed, via: 'fence' };
  }

  // The first balanced {...} or [...] in the text.
  const sliced = extractBalanced(text);
  if (sliced) {
    const parsed = attempt<T>(sliced);
    if (parsed !== undefined) return { ok: true, data: parsed, via: 'slice' };

    const repaired = attempt<T>(repair(sliced));
    if (repaired !== undefined) return { ok: true, data: repaired, via: 'repaired' };
  }

  const repaired = attempt<T>(repair(text));
  if (repaired !== undefined) return { ok: true, data: repaired, via: 'repaired' };

  return { ok: false, data: null, via: 'failed' };
}

function attempt<T>(text: string): T | undefined {
  try {
    return JSON.parse(text) as T;
  } catch {
    return undefined;
  }
}

/** Find the first complete JSON value in a string, respecting strings and escapes. */
function extractBalanced(text: string): string | null {
  const start = text.search(/[{[]/);
  if (start === -1) return null;

  const open = text[start]!;
  const close = open === '{' ? '}' : ']';
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < text.length; i++) {
    const char = text[i]!;

    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === '\\') {
      escaped = true;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;

    if (char === open) depth++;
    else if (char === close) {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }

  // Unterminated — close what is open and let the repair pass try.
  return text.slice(start);
}

/** Fix the handful of malformations models actually produce. */
function repair(text: string): string {
  let out = text.trim();

  // Strip a leading language tag left over from a broken fence.
  out = out.replace(/^json\s*/i, '');

  // Trailing commas before a closing brace or bracket.
  out = out.replace(/,\s*([}\]])/g, '$1');

  // Smart quotes around keys and values.
  out = out.replace(/[“”]/g, '"').replace(/[‘’]/g, "'");

  // Close any brackets left open by a truncated response.
  const stack: string[] = [];
  let inString = false;
  let escaped = false;
  for (const char of out) {
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === '\\') {
      escaped = true;
      continue;
    }
    if (char === '"') inString = !inString;
    if (inString) continue;
    if (char === '{' || char === '[') stack.push(char);
    else if (char === '}' || char === ']') stack.pop();
  }
  if (inString) out += '"';
  while (stack.length > 0) {
    out += stack.pop() === '{' ? '}' : ']';
  }

  return out;
}

/**
 * A compact, human-readable rendering of a JSON Schema, appended to system
 * prompts for providers without a native structured-output mode.
 */
export function describeSchema(schema: Record<string, unknown>): string {
  return JSON.stringify(schema, null, 2);
}

/**
 * OpenAI-style strict schemas require every property to be listed in
 * `required`. Optional fields become nullable instead, which preserves intent.
 */
export function strictify(schema: Record<string, unknown>): Record<string, unknown> {
  if (schema.type !== 'object' || typeof schema.properties !== 'object') return schema;

  const properties = schema.properties as Record<string, Record<string, unknown>>;
  const out: Record<string, unknown> = {
    ...schema,
    additionalProperties: false,
    required: Object.keys(properties),
    properties: Object.fromEntries(
      Object.entries(properties).map(([key, value]) => [key, strictifyValue(value)]),
    ),
  };
  return out;
}

function strictifyValue(value: Record<string, unknown>): Record<string, unknown> {
  if (value.type === 'object') return strictify(value);
  if (value.type === 'array' && value.items && typeof value.items === 'object') {
    return { ...value, items: strictifyValue(value.items as Record<string, unknown>) };
  }
  return value;
}
