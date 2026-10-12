import { Analyzer, Rejection, type Node } from './analyzer';
import { TABLES } from './__fixtures__/tables';

// Hand-built parse trees for shapes the PostgreSQL 17 grammar does not produce today. They
// prove default deny: if a later parser adds a field or node type, the guard rejects it.

const one: Node = { A_Const: { ival: { ival: 1 } } };
const name = (value: string): Node => ({ String: { sval: value } });
const table = (relname: string): Node => ({
  RangeVar: { relname, inh: true, relpersistence: 'p' },
});

function select(extra: Node): Node {
  return {
    targetList: [{ ResTarget: { val: one } }],
    limitOption: 'LIMIT_OPTION_DEFAULT',
    op: 'SETOP_NONE',
    ...extra,
  };
}

function verdict(tree: Node): string {
  try {
    new Analyzer(TABLES).analyze(tree);
    return 'accepted';
  } catch (error) {
    if (error instanceof Rejection) {
      return error.code;
    }
    throw error;
  }
}

describe('Analyzer default deny', () => {
  it.each<[string, Node]>([
    ['an unknown field on SELECT', select({ futureClause: [] })],
    ['an unknown expression node', select({ whereClause: { FutureExpr: {} } })],
    [
      'an unknown join type',
      select({
        fromClause: [
          {
            JoinExpr: {
              jointype: 'JOIN_SEMI',
              larg: table('orders'),
              rarg: table('payments'),
            },
          },
        ],
      }),
    ],
    ['an unknown FROM item', select({ fromClause: [{ RangeTableFunc: {} }] })],
    [
      'an unknown operator kind',
      select({
        whereClause: {
          A_Expr: { kind: 'AEXPR_FUTURE', name: [name('=')], lexpr: one, rexpr: one },
        },
      }),
    ],
    ['a value that is not a node', select({ whereClause: 'text' })],
    ['a list that is not a list', select({ fromClause: {} })],
    [
      'a name that is not a string node',
      select({
        fromClause: [table('orders')],
        targetList: [
          { ResTarget: { val: { ColumnRef: { fields: [{ Integer: { ival: 1 } }] } } } },
        ],
      }),
    ],
    [
      'a SELECT list item with indirection',
      select({ targetList: [{ ResTarget: { indirection: [], val: one } }] }),
    ],
    [
      'the wrong node where a SELECT list item belongs',
      select({ targetList: [{ SortBy: {} }] }),
    ],
    [
      'a FROM subquery that is not a SELECT',
      select({
        fromClause: [
          { RangeSubselect: { subquery: { InsertStmt: {} }, alias: { aliasname: 's' } } },
        ],
      }),
    ],
    [
      'an expression subquery that is not a SELECT',
      select({
        whereClause: {
          SubLink: { subLinkType: 'EXISTS_SUBLINK', subselect: { InsertStmt: {} } },
        },
      }),
    ],
    [
      'a set operation branch that is not a node',
      {
        op: 'SETOP_UNION',
        larg: 'x',
        rarg: select({}),
        limitOption: 'LIMIT_OPTION_DEFAULT',
      },
    ],
  ])('rejects %s', (_case, tree) => {
    expect(verdict(tree)).toBe('unsupported_syntax');
  });

  it('accepts set operation branches whether or not they are wrapped', () => {
    expect(
      verdict({
        op: 'SETOP_UNION',
        larg: { SelectStmt: select({}) },
        rarg: select({}),
        limitOption: 'LIMIT_OPTION_DEFAULT',
      }),
    ).toBe('accepted');
  });
});
