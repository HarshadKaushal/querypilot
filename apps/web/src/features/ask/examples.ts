import type { SchemaView } from '../../lib/api-types';

function words(name: string): string {
  return name.replace(/_/g, ' ');
}

function singular(name: string): string {
  return name.endsWith('ies')
    ? `${name.slice(0, -3)}y`
    : name.endsWith('s') && !name.endsWith('ss')
      ? name.slice(0, -1)
      : name;
}

/**
 * Up to three example questions drawn from the tables the AI may see (blueprint 16), so a
 * new user sees what kind of question works: a count, a count per related row (from a
 * foreign key), and a count over time (from a date column).
 */
export function examplesFor(schema: SchemaView): string[] {
  const examples: string[] = [];
  const [first] = schema.tables;
  if (first) {
    examples.push(`How many ${words(first.name)} are there?`);
  }
  const allowed = new Set(schema.tables.map((t) => `${t.schema}.${t.name}`));
  const child = schema.tables.find((t) =>
    t.foreignKeys.some((fk) =>
      allowed.has(`${fk.references.schema}.${fk.references.table}`),
    ),
  );
  const parent = child?.foreignKeys.find((fk) =>
    allowed.has(`${fk.references.schema}.${fk.references.table}`),
  )?.references.table;
  if (child && parent) {
    examples.push(
      `How many ${words(child.name)} does each ${words(singular(parent))} have?`,
    );
  }
  const dated = schema.tables.find((t) =>
    t.columns.some((c) => c.type === 'date' || c.type.startsWith('timestamp')),
  );
  if (dated) {
    examples.push(`How many ${words(dated.name)} were there each month?`);
  }
  return [...new Set(examples)].slice(0, 3);
}
