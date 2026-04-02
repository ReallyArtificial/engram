import type { Fact, Observation } from '../types.js';

export function buildExtractionPrompt(
  text: string,
  bankContext?: string,
): string {
  const contextLine = bankContext
    ? `\nContext about this memory bank: ${bankContext}\n`
    : '';

  return `Extract atomic facts, entities, and relationships from the following text.
${contextLine}
Rules:
- Each fact should be a single, self-contained piece of information
- Entity types: person, organization, location, technology, concept, project, product, event
- Relations describe how entities relate: works_at, uses, knows, created, part_of, likes, dislikes, etc.
- If a date or time is mentioned for a fact, include it in occurredAt as an ISO date string
- Be thorough but avoid duplicating the same fact in different words
- Prefer specific facts over vague summaries

Text:
${text}`;
}

export function buildReflectionPrompt(
  facts: Fact[],
  existingObservations: Observation[],
  bankContext?: string,
): string {
  const contextLine = bankContext
    ? `\nContext about this memory bank: ${bankContext}\n`
    : '';

  const factsBlock = facts
    .map((f, i) => `${i + 1}. ${f.content}`)
    .join('\n');

  const existingBlock =
    existingObservations.length > 0
      ? `\nExisting observations (DO NOT duplicate these):\n${existingObservations
          .map((o) => `- [${o.observationType}] ${o.content} (confidence: ${o.confidence.toFixed(2)})`)
          .join('\n')}\n`
      : '';

  return `Analyze these facts and synthesize higher-order observations.
${contextLine}
Facts:
${factsBlock}
${existingBlock}
Rules:
- Look for patterns (recurring behaviors/events), preferences (stated or implied likes/dislikes/choices), and insights (non-obvious connections or conclusions)
- Each observation should be supported by at least 2 facts
- Be specific and actionable — avoid vague generalizations
- Do NOT repeat existing observations listed above
- Only create observations you are reasonably confident about`;
}

export function buildEvidencePrompt(
  fact: Fact,
  observation: Observation,
): string {
  return `Does this new fact confirm, contradict, or have no bearing on this observation?

New fact: "${fact.content}"

Observation [${observation.observationType}]: "${observation.content}" (current confidence: ${observation.confidence.toFixed(2)})

Rules:
- adjustment > 0 means the fact confirms/supports the observation
- adjustment < 0 means the fact contradicts/undermines the observation
- adjustment near 0 means the fact is unrelated
- Scale: -0.3 (strongly contradicts) to +0.3 (strongly confirms)
- Most facts will have small adjustments (±0.01 to ±0.1)`;
}
