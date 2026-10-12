import { loadModule, parseSync } from 'libpg-query';
import { deparseSync } from 'pgsql-deparser';
import { Analyzer, applyRowCap, Rejection, unwrap } from './analyzer';
import type { GuardOptions, GuardVerdict } from './types';

/** Longer SQL is refused before it reaches the parser. */
export const MAX_SQL_LENGTH = 20000;

type ParseTree = Parameters<typeof deparseSync>[0] & { stmts?: Array<{ stmt: unknown }> };

const STATEMENT_NAMES: Record<string, string> = {
  InsertStmt: 'INSERT',
  UpdateStmt: 'UPDATE',
  DeleteStmt: 'DELETE',
  MergeStmt: 'MERGE',
  TruncateStmt: 'TRUNCATE',
  CopyStmt: 'COPY',
  DoStmt: 'DO',
  CallStmt: 'CALL',
  ExplainStmt: 'EXPLAIN',
  TransactionStmt: 'a transaction command',
  VariableSetStmt: 'SET',
  VariableShowStmt: 'SHOW',
  CreateStmt: 'CREATE TABLE',
  CreateTableAsStmt: 'CREATE TABLE AS',
  DropStmt: 'DROP',
  AlterTableStmt: 'ALTER TABLE',
  GrantStmt: 'GRANT',
  LockStmt: 'LOCK',
  VacuumStmt: 'VACUUM',
};

let parserReady: Promise<void> | undefined;

/**
 * Decides whether SQL is a single safe read over allowlisted tables and columns, and
 * returns the SQL to run instead: fully qualified, with SELECT * expanded and LIMIT capped.
 * Pure: it never opens a network connection or a database.
 */
export async function checkSql(
  sql: string,
  options: GuardOptions,
): Promise<GuardVerdict> {
  if (!Number.isInteger(options.rowCap) || options.rowCap < 1) {
    throw new Error('rowCap must be a positive whole number');
  }
  parserReady ??= loadModule();
  await parserReady;
  try {
    if (sql.length > MAX_SQL_LENGTH) {
      throw new Rejection(
        'too_long',
        `The SQL is longer than ${MAX_SQL_LENGTH} characters.`,
      );
    }
    const first = rewrite(sql, options);
    const output = deparseSync(first.tree, { pretty: false });
    // The deparser is not PostgreSQL's own code. Its output is parsed again by the real
    // parser and checked again, and has to come back unchanged, before it is returned.
    let second: ReturnType<typeof rewrite>;
    try {
      second = rewrite(output, options);
    } catch (error) {
      if (error instanceof Rejection) {
        throw new Rejection(
          'verification_failed',
          `The rewritten SQL did not pass the guard again: ${error.reason}`,
        );
      }
      throw error;
    }
    if (deparseSync(second.tree, { pretty: false }) !== output) {
      throw new Rejection(
        'verification_failed',
        'The rewritten SQL did not come back unchanged from the parser.',
      );
    }
    return { ok: true, sql: output, limitApplied: first.limitApplied };
  } catch (error) {
    if (error instanceof Rejection) {
      return { ok: false, code: error.code, reason: error.reason };
    }
    throw error;
  }
}

function rewrite(
  sql: string,
  options: GuardOptions,
): { tree: ParseTree; limitApplied: boolean } {
  // libpg_query reports an empty string as a parse error rather than as no statements.
  if (sql.trim().length === 0) {
    throw new Rejection('empty', 'There is no SQL statement.');
  }
  let tree: ParseTree;
  try {
    tree = parseSync(sql) as ParseTree;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown error';
    throw new Rejection(
      'parse_error',
      `The SQL could not be parsed: ${message.slice(0, 200)}`,
    );
  }
  const statements = tree.stmts ?? [];
  if (statements.length === 0) {
    throw new Rejection('empty', 'There is no SQL statement.');
  }
  if (statements.length > 1) {
    throw new Rejection('multiple_statements', 'Only one statement is allowed.');
  }
  const [kind, select] = unwrap(statements[0]!.stmt);
  if (kind !== 'SelectStmt') {
    const name = STATEMENT_NAMES[kind] ?? `a ${kind.replace(/Stmt$/, '')} statement`;
    throw new Rejection('not_select', `Only SELECT is allowed, and this is ${name}.`);
  }
  new Analyzer(options.tables).analyze(select);
  return { tree, limitApplied: applyRowCap(select, options.rowCap) };
}
