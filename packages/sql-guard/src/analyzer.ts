import { FUNCTIONS, OPERATORS, SQL_VALUE_FUNCTIONS, TYPES } from './allowlists';
import type { GuardColumn, GuardTable, RejectionCode } from './types';

// Walks a PostgreSQL parse tree (libpg_query JSON) and rejects anything outside the allowed
// subset. Default deny: an unknown node type, or an unknown field on a known one, is
// rejected. While walking it rewrites the tree in place so PostgreSQL cannot read it any
// other way than the guard did: tables get their schema, column references get the alias
// they were resolved to, and SELECT * becomes the list of allowed columns.

export class Rejection extends Error {
  constructor(
    readonly code: RejectionCode,
    readonly reason: string,
  ) {
    super(reason);
  }
}

export type Node = Record<string, unknown>;

const MAX_DEPTH = 100;

/** Something in a FROM clause: a table, a WITH query, or a subquery, under its name. */
interface Entry {
  refname: string;
  /** For a table, every column, hidden ones included. For anything else, its outputs. */
  columns: GuardColumn[];
  table?: GuardTable;
  aliased: boolean;
}

/** One query level. `parent` is the enclosing query, for correlated references. */
interface Scope {
  parent: Scope | null;
  entries: Entry[];
  ctes: Map<string, string[]>;
}

interface Output {
  name: string;
  /** True when PostgreSQL is sure to use this name: an explicit alias or a plain column. */
  certain: boolean;
}

const SELECT_FIELDS = [
  'distinctClause',
  'intoClause',
  'targetList',
  'fromClause',
  'whereClause',
  'groupClause',
  'groupDistinct',
  'havingClause',
  'windowClause',
  'valuesLists',
  'sortClause',
  'limitOffset',
  'limitCount',
  'limitOption',
  'lockingClause',
  'withClause',
  'op',
  'all',
  'larg',
  'rarg',
];

const JOIN_TYPES = new Set(['JOIN_INNER', 'JOIN_LEFT', 'JOIN_RIGHT', 'JOIN_FULL']);

const OPERATOR_KINDS = new Set([
  'AEXPR_OP',
  'AEXPR_OP_ANY',
  'AEXPR_OP_ALL',
  'AEXPR_DISTINCT',
  'AEXPR_NOT_DISTINCT',
  'AEXPR_NULLIF',
  'AEXPR_IN',
  'AEXPR_LIKE',
  'AEXPR_ILIKE',
  'AEXPR_SIMILAR',
]);

const BETWEEN_KINDS = new Set([
  'AEXPR_BETWEEN',
  'AEXPR_NOT_BETWEEN',
  'AEXPR_BETWEEN_SYM',
  'AEXPR_NOT_BETWEEN_SYM',
]);

const SUBLINK_TYPES = new Set([
  'EXISTS_SUBLINK',
  'ANY_SUBLINK',
  'ALL_SUBLINK',
  'EXPR_SUBLINK',
]);

export class Analyzer {
  private depth = 0;
  private readonly tables = new Map<string, GuardTable>();

  constructor(tables: GuardTable[]) {
    for (const table of tables) {
      this.tables.set(tableKey(table.schema, table.name), table);
    }
  }

  /** Checks one top-level SELECT and rewrites it in place. Throws Rejection. */
  analyze(select: Node): void {
    this.select(select, null, new Map());
  }

  private select(
    body: Node,
    parent: Scope | null,
    ctes: Map<string, string[]>,
  ): Output[] {
    this.enter();
    try {
      fields(body, 'SELECT', SELECT_FIELDS);
      if (body.intoClause !== undefined) {
        throw new Rejection(
          'writes_data',
          'SELECT INTO creates a table and is not allowed.',
        );
      }
      if (body.lockingClause !== undefined) {
        throw new Rejection(
          'locking_clause',
          'Locking clauses such as FOR UPDATE and FOR SHARE are not allowed.',
        );
      }
      if (body.valuesLists !== undefined) {
        throw unsupported('VALUES lists are not supported.');
      }
      checkLimit(body);
      const visible =
        body.withClause === undefined
          ? ctes
          : this.withClause(body.withClause, parent, ctes);
      if (body.op !== undefined && body.op !== 'SETOP_NONE') {
        return this.setOperation(body, parent, visible);
      }

      const scope: Scope = { parent, entries: [], ctes: visible };
      for (const item of list(body.fromClause)) {
        this.fromItem(item, scope);
      }
      const outputs = this.targetList(body, scope);
      this.expr(body.whereClause, scope);
      for (const item of list(body.groupClause)) {
        this.groupItem(item, scope, outputs);
      }
      this.expr(body.havingClause, scope);
      for (const item of list(body.windowClause)) {
        this.windowDef(unwrapAs(item, 'WindowDef'), scope);
      }
      this.distinct(body.distinctClause, scope, outputs);
      for (const item of list(body.sortClause)) {
        this.sortBy(item, scope, outputs);
      }
      return outputs;
    } finally {
      this.leave();
    }
  }

  private setOperation(
    body: Node,
    parent: Scope | null,
    ctes: Map<string, string[]>,
  ): Output[] {
    const left = this.select(selectBody(body.larg), parent, ctes);
    this.select(selectBody(body.rarg), parent, ctes);
    const names = new Set(left.map((output) => output.name));
    for (const item of list(body.sortClause)) {
      const sort = sortFields(item);
      const [kind, node] = unwrap(sort.node);
      if (kind === 'A_Const' && intValue(node) !== undefined) {
        continue;
      }
      if (kind === 'ColumnRef') {
        const parts = list(node.fields);
        if (parts.length === 1 && isString(parts[0]) && names.has(str(parts[0]))) {
          continue;
        }
      }
      throw unsupported(
        'ORDER BY after UNION, INTERSECT, or EXCEPT can only name an output column or its position.',
      );
    }
    return left;
  }

  private withClause(
    node: unknown,
    parent: Scope | null,
    ctes: Map<string, string[]>,
  ): Map<string, string[]> {
    const body =
      isObject(node) && 'WithClause' in node
        ? unwrapAs(node, 'WithClause')
        : (node as Node);
    fields(body, 'WITH', ['ctes', 'recursive']);
    if (body.recursive === true) {
      throw new Rejection(
        'recursive_query',
        'WITH RECURSIVE is not allowed, because it can run without bound.',
      );
    }
    const visible = new Map(ctes);
    const defined = new Set<string>();
    for (const item of list(body.ctes)) {
      const cte = unwrapAs(item, 'CommonTableExpr');
      fields(cte, 'WITH query', [
        'ctename',
        'aliascolnames',
        'ctematerialized',
        'ctequery',
      ]);
      const name = String(cte.ctename);
      if (defined.has(name)) {
        throw new Rejection(
          'ambiguous_reference',
          `The WITH query name ${show(name)} is defined twice.`,
        );
      }
      defined.add(name);
      const [kind, query] = unwrap(cte.ctequery);
      if (kind !== 'SelectStmt') {
        throw new Rejection(
          'writes_data',
          `A WITH query may only contain SELECT, and ${show(name)} does not.`,
        );
      }
      const outputs = this.select(query, parent, visible).map((output) => output.name);
      visible.set(name, rename(outputs, cte.aliascolnames));
    }
    return visible;
  }

  private fromItem(node: unknown, scope: Scope): void {
    this.enter();
    try {
      const [kind, body] = unwrap(node);
      switch (kind) {
        case 'RangeVar':
          return this.rangeVar(body, scope);
        case 'JoinExpr':
          return this.join(body, scope);
        case 'RangeSubselect':
          return this.subselect(body, scope);
        case 'RangeFunction':
          throw new Rejection(
            'function_not_allowed',
            'Functions in FROM are not allowed.',
          );
        case 'RangeTableSample':
          throw unsupported('TABLESAMPLE is not supported.');
        default:
          throw unsupported(`${kind} in FROM is not supported.`);
      }
    } finally {
      this.leave();
    }
  }

  private rangeVar(body: Node, scope: Scope): void {
    fields(body, 'table reference', [
      'catalogname',
      'schemaname',
      'relname',
      'inh',
      'relpersistence',
      'alias',
    ]);
    const relname = String(body.relname);
    const alias = body.alias === undefined ? null : aliasOf(body.alias);
    if (body.catalogname !== undefined) {
      throw new Rejection(
        'table_not_allowed',
        `Database-qualified names such as ${show(`${String(body.catalogname)}.${relname}`)} are not allowed.`,
      );
    }
    const cte = body.schemaname === undefined ? scope.ctes.get(relname) : undefined;
    if (cte) {
      const names = rename(cte, alias?.colnames);
      this.addEntry(scope, {
        refname: alias?.name ?? relname,
        columns: names.map((name) => ({ name, allowed: true })),
        aliased: alias !== null,
      });
      return;
    }
    const schema = body.schemaname === undefined ? 'public' : String(body.schemaname);
    const table = this.tables.get(tableKey(schema, relname));
    if (!table || !table.allowed) {
      const hint =
        body.schemaname === undefined
          ? ' A table name without a schema means public.'
          : '';
      throw new Rejection(
        'table_not_allowed',
        `The table ${show(`${schema}.${relname}`)} is not on the allowlist.${hint}`,
      );
    }
    if (alias?.colnames !== undefined) {
      throw unsupported(
        'Column aliases on a table, as in AS t(a, b), are not supported. Rename columns in the SELECT list instead.',
      );
    }
    body.schemaname = table.schema;
    this.addEntry(scope, {
      refname: alias?.name ?? table.name,
      columns: table.columns,
      table,
      aliased: alias !== null,
    });
  }

  private join(body: Node, scope: Scope): void {
    fields(body, 'JOIN', [
      'jointype',
      'isNatural',
      'larg',
      'rarg',
      'usingClause',
      'join_using_alias',
      'quals',
      'alias',
      'rtindex',
    ]);
    if (body.isNatural === true) {
      throw unsupported(
        'NATURAL JOIN is not supported. Join with ON and name the columns.',
      );
    }
    if (body.usingClause !== undefined) {
      throw unsupported(
        'JOIN ... USING is not supported. Write ON a.column = b.column instead.',
      );
    }
    if (body.alias !== undefined || body.join_using_alias !== undefined) {
      throw unsupported('An alias on a whole JOIN is not supported.');
    }
    if (!JOIN_TYPES.has(String(body.jointype))) {
      throw unsupported(`${String(body.jointype)} is not supported.`);
    }
    this.fromItem(body.larg, scope);
    this.fromItem(body.rarg, scope);
    this.expr(body.quals, scope);
  }

  private subselect(body: Node, scope: Scope): void {
    fields(body, 'subquery in FROM', ['lateral', 'subquery', 'alias']);
    if (body.lateral === true) {
      throw unsupported('LATERAL is not supported.');
    }
    if (body.alias === undefined) {
      throw unsupported('A subquery in FROM needs an alias, as in (SELECT ...) AS s.');
    }
    const alias = aliasOf(body.alias);
    const [kind, query] = unwrap(body.subquery);
    if (kind !== 'SelectStmt') {
      throw unsupported(`${kind} as a subquery is not supported.`);
    }
    // A subquery in FROM cannot see its siblings, only the enclosing query levels.
    const outputs = this.select(query, scope.parent, scope.ctes).map(
      (output) => output.name,
    );
    this.addEntry(scope, {
      refname: alias.name,
      columns: rename(outputs, alias.colnames).map((name) => ({ name, allowed: true })),
      aliased: true,
    });
  }

  private addEntry(scope: Scope, entry: Entry): void {
    if (scope.entries.some((existing) => existing.refname === entry.refname)) {
      throw new Rejection(
        'ambiguous_reference',
        `The name ${show(entry.refname)} is used for more than one table in the same FROM clause. Give each one its own alias.`,
      );
    }
    scope.entries.push(entry);
  }

  private targetList(body: Node, scope: Scope): Output[] {
    if (body.targetList === undefined) {
      return [];
    }
    const outputs: Output[] = [];
    const rewritten: unknown[] = [];
    for (const item of list(body.targetList)) {
      const target = unwrapAs(item, 'ResTarget');
      fields(target, 'SELECT list item', ['name', 'indirection', 'val']);
      if (target.indirection !== undefined) {
        throw unsupported(
          'Subscripts and field selection in the SELECT list are not supported.',
        );
      }
      const star = starFields(target.val);
      if (star) {
        for (const { refname, column } of this.expandStar(star, scope)) {
          rewritten.push({ ResTarget: { val: columnRef(refname, column) } });
          outputs.push({ name: column, certain: true });
        }
        continue;
      }
      this.expr(target.val, scope);
      rewritten.push(item);
      outputs.push(outputName(target));
    }
    body.targetList = rewritten;
    return outputs;
  }

  private expandStar(
    parts: unknown[],
    scope: Scope,
  ): Array<{ refname: string; column: string }> {
    const qualifiers = parts.slice(0, -1).map(str);
    let entries: Entry[];
    if (qualifiers.length === 0) {
      if (scope.entries.length === 0) {
        throw unsupported('SELECT * needs a FROM clause.');
      }
      entries = scope.entries;
    } else if (qualifiers.length === 1) {
      const found = findRef(qualifiers[0]!, scope);
      if (!found) {
        throw new Rejection(
          'column_not_allowed',
          `There is no table or alias named ${show(qualifiers[0]!)} in this query.`,
        );
      }
      entries = [found.entry];
    } else {
      throw unsupported('Write * or alias.*, without a schema name.');
    }
    const columns: Array<{ refname: string; column: string }> = [];
    for (const entry of entries) {
      if (!entry.table) {
        throw unsupported(
          `* over the subquery or WITH query ${show(entry.refname)} is not supported. List its columns instead.`,
        );
      }
      const allowed = entry.columns.filter((column) => column.allowed);
      if (allowed.length === 0) {
        throw new Rejection(
          'column_not_allowed',
          `The table ${display(entry)} has no allowed columns.`,
        );
      }
      for (const column of allowed) {
        columns.push({ refname: entry.refname, column: column.name });
      }
    }
    return columns;
  }

  private groupItem(node: unknown, scope: Scope, outputs: Output[]): void {
    const [kind, body] = unwrap(node);
    if (kind === 'GroupingSet') {
      fields(body, 'GROUPING SETS', ['kind', 'content']);
      for (const item of list(body.content)) {
        this.groupItem(item, scope, outputs);
      }
      return;
    }
    // GROUP BY name: PostgreSQL tries a column of this query level first, then an output
    // column name. Only certain output names are treated as outputs here.
    const name = bareName(kind, body);
    if (
      name !== undefined &&
      !scope.entries.some((entry) =>
        entry.columns.some((column) => column.name === name),
      ) &&
      outputs.filter((output) => output.certain && output.name === name).length === 1
    ) {
      return;
    }
    this.expr(node, scope);
  }

  private distinct(clause: unknown, scope: Scope, outputs: Output[]): void {
    const items = list(clause);
    if (items.length === 1 && isObject(items[0]) && Object.keys(items[0]).length === 0) {
      return;
    }
    for (const item of items) {
      this.orderTarget(item, scope, outputs);
    }
  }

  private sortBy(node: unknown, scope: Scope, outputs: Output[] | null): void {
    const sort = sortFields(node);
    if (outputs) {
      this.orderTarget(sort.node, scope, outputs);
    } else {
      this.expr(sort.node, scope);
    }
  }

  // ORDER BY and DISTINCT ON name: PostgreSQL tries output column names first.
  private orderTarget(node: unknown, scope: Scope, outputs: Output[]): void {
    const [kind, body] = unwrap(node);
    const name = bareName(kind, body);
    if (name !== undefined) {
      const matches = outputs.filter((output) => output.certain && output.name === name);
      if (matches.length > 1) {
        throw new Rejection(
          'ambiguous_reference',
          `ORDER BY ${show(name)} matches more than one output column.`,
        );
      }
      if (matches.length === 1) {
        return;
      }
    }
    this.expr(node, scope);
  }

  private windowDef(body: Node, scope: Scope): void {
    fields(body, 'window', [
      'name',
      'refname',
      'partitionClause',
      'orderClause',
      'frameOptions',
      'startOffset',
      'endOffset',
    ]);
    for (const item of list(body.partitionClause)) {
      this.expr(item, scope);
    }
    for (const item of list(body.orderClause)) {
      this.sortBy(item, scope, null);
    }
    this.expr(body.startOffset, scope);
    this.expr(body.endOffset, scope);
  }

  private expr(node: unknown, scope: Scope): void {
    if (node === undefined) {
      return;
    }
    this.enter();
    try {
      const [kind, body] = unwrap(node);
      switch (kind) {
        case 'A_Const':
          fields(body, 'constant', [
            'ival',
            'fval',
            'sval',
            'boolval',
            'bsval',
            'isnull',
          ]);
          return;
        case 'ColumnRef':
          return this.column(body, scope);
        case 'A_Expr':
          return this.operator(body, scope);
        case 'BoolExpr':
          fields(body, 'AND/OR/NOT', ['boolop', 'args']);
          return this.exprs(body.args, scope);
        case 'NullTest':
          fields(body, 'IS NULL', ['arg', 'nulltesttype', 'argisrow']);
          return this.expr(body.arg, scope);
        case 'BooleanTest':
          fields(body, 'IS TRUE', ['arg', 'booltesttype']);
          return this.expr(body.arg, scope);
        case 'CaseExpr':
          return this.caseExpr(body, scope);
        case 'CoalesceExpr':
          fields(body, 'COALESCE', ['args', 'coalescetype', 'coalescecollid']);
          return this.exprs(body.args, scope);
        case 'MinMaxExpr':
          fields(body, 'GREATEST/LEAST', [
            'op',
            'args',
            'minmaxtype',
            'minmaxcollid',
            'inputcollid',
          ]);
          return this.exprs(body.args, scope);
        case 'FuncCall':
          return this.funcCall(body, scope);
        case 'TypeCast':
          fields(body, 'cast', ['arg', 'typeName']);
          this.typeName(body.typeName, scope);
          return this.expr(body.arg, scope);
        case 'SubLink':
          return this.subLink(body, scope);
        case 'SQLValueFunction':
          return sqlValueFunction(body);
        case 'GroupingFunc':
          fields(body, 'GROUPING', ['args', 'refs', 'agglevelsup']);
          return this.exprs(body.args, scope);
        case 'List':
          fields(body, 'list', ['items']);
          return this.exprs(body.items, scope);
        default:
          throw unsupported(`${describe(kind)} is not supported.`);
      }
    } finally {
      this.leave();
    }
  }

  private exprs(value: unknown, scope: Scope): void {
    for (const item of list(value)) {
      this.expr(item, scope);
    }
  }

  private operator(body: Node, scope: Scope): void {
    fields(body, 'operator', ['kind', 'name', 'lexpr', 'rexpr']);
    const names = list(body.name).map(str);
    if (names.length !== 1) {
      throw unsupported('Operators written as OPERATOR(schema.op) are not allowed.');
    }
    const kind = String(body.kind);
    if (OPERATOR_KINDS.has(kind)) {
      if (!OPERATORS.has(names[0]!)) {
        throw unsupported(`The operator ${show(names[0]!)} is not allowed.`);
      }
    } else if (!BETWEEN_KINDS.has(kind)) {
      throw unsupported(`${kind} is not supported.`);
    }
    this.expr(body.lexpr, scope);
    this.expr(body.rexpr, scope);
  }

  private caseExpr(body: Node, scope: Scope): void {
    fields(body, 'CASE', ['casetype', 'casecollid', 'arg', 'args', 'defresult']);
    this.expr(body.arg, scope);
    for (const item of list(body.args)) {
      const when = unwrapAs(item, 'CaseWhen');
      fields(when, 'WHEN', ['expr', 'result']);
      this.expr(when.expr, scope);
      this.expr(when.result, scope);
    }
    this.expr(body.defresult, scope);
  }

  private funcCall(body: Node, scope: Scope): void {
    fields(body, 'function call', [
      'funcname',
      'args',
      'agg_order',
      'agg_filter',
      'over',
      'agg_within_group',
      'agg_star',
      'agg_distinct',
      'func_variadic',
      'funcformat',
    ]);
    const names = list(body.funcname).map(str);
    const name = catalogName(names);
    if (name === undefined || !FUNCTIONS.has(name)) {
      throw new Rejection(
        'function_not_allowed',
        `The function ${show(names.join('.'))} is not allowed.`,
      );
    }
    if (body.func_variadic === true) {
      throw unsupported('VARIADIC arguments are not supported.');
    }
    this.exprs(body.args, scope);
    for (const item of list(body.agg_order)) {
      this.sortBy(item, scope, null);
    }
    this.expr(body.agg_filter, scope);
    if (body.over !== undefined) {
      this.windowDef(body.over as Node, scope);
    }
  }

  private typeName(node: unknown, scope: Scope): void {
    const body = node as Node;
    fields(body, 'type', [
      'names',
      'typeOid',
      'setof',
      'pct_type',
      'typmods',
      'typemod',
      'arrayBounds',
    ]);
    const names = list(body.names).map(str);
    const name = catalogName(names);
    const array = body.arrayBounds !== undefined;
    if (
      name === undefined ||
      !TYPES.has(name) ||
      array ||
      body.setof === true ||
      body.pct_type === true
    ) {
      throw new Rejection(
        'type_not_allowed',
        `Casting to ${show(names.join('.'))}${array ? '[]' : ''} is not allowed.`,
      );
    }
    this.exprs(body.typmods, scope);
  }

  private subLink(body: Node, scope: Scope): void {
    fields(body, 'subquery', [
      'subLinkType',
      'subLinkId',
      'testexpr',
      'operName',
      'subselect',
    ]);
    if (!SUBLINK_TYPES.has(String(body.subLinkType))) {
      throw unsupported(`${String(body.subLinkType)} subqueries are not supported.`);
    }
    const operator = list(body.operName).map(str);
    if (operator.length > 1) {
      throw unsupported('Operators written as OPERATOR(schema.op) are not allowed.');
    }
    if (operator.length === 1 && !OPERATORS.has(operator[0]!)) {
      throw unsupported(`The operator ${show(operator[0]!)} is not allowed.`);
    }
    this.expr(body.testexpr, scope);
    const [kind, query] = unwrap(body.subselect);
    if (kind !== 'SelectStmt') {
      throw unsupported(`${kind} as a subquery is not supported.`);
    }
    // A subquery in an expression can refer to the query around it.
    this.select(query, scope, scope.ctes);
  }

  private column(body: Node, scope: Scope): void {
    fields(body, 'column reference', ['fields']);
    const parts = list(body.fields);
    if (parts.some((part) => isObject(part) && 'A_Star' in part)) {
      throw new Rejection(
        'column_not_allowed',
        '* is only allowed as SELECT *, SELECT alias.*, or count(*).',
      );
    }
    const names = parts.map(str);
    if (names.length === 1) {
      return this.bareColumn(names[0]!, body, scope);
    }
    if (names.length === 2) {
      return this.qualifiedColumn(names[0]!, names[1]!, scope);
    }
    if (names.length === 3) {
      return this.schemaQualifiedColumn(names as [string, string, string], body, scope);
    }
    throw unsupported(
      `The column reference ${show(names.join('.'))} has too many parts.`,
    );
  }

  private bareColumn(name: string, body: Node, scope: Scope): void {
    for (let level: Scope | null = scope; level; level = level.parent) {
      const matches = level.entries.flatMap((entry) =>
        entry.columns
          .filter((column) => column.name === name)
          .map((column) => ({ entry, column })),
      );
      if (matches.length > 1) {
        throw new Rejection(
          'ambiguous_reference',
          `The column ${show(name)} is ambiguous. Qualify it with a table alias.`,
        );
      }
      const match = matches[0];
      if (match) {
        if (!match.column.allowed) {
          throw notAllowed(match.entry, name);
        }
        assertNotShadowed(match.entry, level, scope);
        body.fields = [stringNode(match.entry.refname), stringNode(name)];
        return;
      }
    }
    if (findRef(name, scope)) {
      throw new Rejection(
        'column_not_allowed',
        `${show(name)} refers to a whole row, which can include hidden columns. List the columns instead.`,
      );
    }
    throw new Rejection(
      'column_not_allowed',
      `The column ${show(name)} is not on the allowlist for the tables in this query.`,
    );
  }

  private qualifiedColumn(refname: string, name: string, scope: Scope): void {
    const found = findRef(refname, scope);
    if (!found) {
      throw new Rejection(
        'column_not_allowed',
        `There is no table or alias named ${show(refname)} in this query.`,
      );
    }
    checkColumn(found.entry, name);
  }

  private schemaQualifiedColumn(
    [schema, relname, name]: [string, string, string],
    body: Node,
    scope: Scope,
  ): void {
    for (let level: Scope | null = scope; level; level = level.parent) {
      const entry = level.entries.find(
        (item) =>
          item.table !== undefined &&
          !item.aliased &&
          item.table.schema === schema &&
          item.table.name === relname,
      );
      if (entry) {
        checkColumn(entry, name);
        assertNotShadowed(entry, level, scope);
        body.fields = [stringNode(entry.refname), stringNode(name)];
        return;
      }
    }
    throw new Rejection(
      'column_not_allowed',
      `The table ${show(`${schema}.${relname}`)} is not in this query under that name.`,
    );
  }

  private enter(): void {
    this.depth += 1;
    if (this.depth > MAX_DEPTH) {
      throw new Rejection('too_complex', 'The query is nested too deeply.');
    }
  }

  private leave(): void {
    this.depth -= 1;
  }
}

/** Caps the top-level LIMIT. Returns true when it added a LIMIT or lowered one. */
export function applyRowCap(select: Node, rowCap: number): boolean {
  const current =
    select.limitCount === undefined ? undefined : unwrap(select.limitCount)[1];
  const value = current && current.isnull !== true ? intValue(current) : undefined;
  if (value !== undefined && value <= rowCap) {
    return false;
  }
  select.limitCount = { A_Const: { ival: { ival: rowCap } } };
  select.limitOption = 'LIMIT_OPTION_COUNT';
  return true;
}

export function unwrap(node: unknown): [string, Node] {
  if (isObject(node)) {
    const keys = Object.keys(node);
    if (keys.length === 1 && isObject(node[keys[0]!])) {
      return [keys[0]!, node[keys[0]!] as Node];
    }
  }
  throw unsupported('The query contains a construct the guard does not recognize.');
}

function unwrapAs(node: unknown, kind: string): Node {
  const [actual, body] = unwrap(node);
  if (actual !== kind) {
    throw unsupported(`${describe(actual)} is not supported here.`);
  }
  return body;
}

/** Set-operation branches arrive as bare SELECT bodies, other subqueries wrapped. */
function selectBody(node: unknown): Node {
  if (isObject(node) && Object.keys(node).length === 1 && 'SelectStmt' in node) {
    return unwrapAs(node, 'SelectStmt');
  }
  if (isObject(node)) {
    return node;
  }
  throw unsupported('The query contains a construct the guard does not recognize.');
}

function sortFields(node: unknown): Node {
  const sort = unwrapAs(node, 'SortBy');
  fields(sort, 'ORDER BY', ['node', 'sortby_dir', 'sortby_nulls', 'useOp']);
  if (sort.useOp !== undefined || sort.sortby_dir === 'SORTBY_USING') {
    throw unsupported('ORDER BY ... USING is not supported.');
  }
  return sort;
}

function checkLimit(body: Node): void {
  if (body.limitOption === 'LIMIT_OPTION_WITH_TIES') {
    throw unsupported(
      'FETCH ... WITH TIES is not supported, because it can return more rows than the limit.',
    );
  }
  for (const [field, label] of [
    ['limitCount', 'LIMIT'],
    ['limitOffset', 'OFFSET'],
  ] as const) {
    if (body[field] === undefined) {
      continue;
    }
    const [kind, constant] = unwrap(body[field]);
    const value = kind === 'A_Const' ? intValue(constant) : undefined;
    const all = field === 'limitCount' && kind === 'A_Const' && constant.isnull === true;
    if (!all && (value === undefined || value < 0)) {
      throw unsupported(`${label} must be a whole number.`);
    }
  }
}

function sqlValueFunction(body: Node): void {
  fields(body, 'SQL value function', ['op', 'type', 'typmod']);
  const op = String(body.op);
  if (!SQL_VALUE_FUNCTIONS.has(op)) {
    throw new Rejection(
      'function_not_allowed',
      `${op.replace(/^SVFOP_/, '').replace(/_N$/, '')} is not allowed.`,
    );
  }
}

function outputName(target: Node): Output {
  if (typeof target.name === 'string') {
    return { name: target.name, certain: true };
  }
  const [kind, body] = unwrap(target.val);
  if (kind === 'ColumnRef') {
    const parts = list(body.fields);
    return { name: str(parts[parts.length - 1]), certain: true };
  }
  return { name: figureName(kind, body), certain: false };
}

// An approximation of PostgreSQL's FigureColname, used only for names a subquery exposes.
// When it differs from PostgreSQL the query fails there; it never widens access.
function figureName(kind: string, body: Node): string {
  switch (kind) {
    case 'FuncCall': {
      const names = list(body.funcname).map(str);
      return names[names.length - 1] ?? '?column?';
    }
    case 'TypeCast': {
      const [argKind, arg] = unwrap(body.arg);
      if (argKind === 'ColumnRef') {
        const parts = list(arg.fields);
        return str(parts[parts.length - 1]);
      }
      if (argKind === 'FuncCall') {
        return figureName(argKind, arg);
      }
      const names = list((body.typeName as Node).names).map(str);
      return names[names.length - 1] ?? '?column?';
    }
    case 'CaseExpr':
      return 'case';
    case 'CoalesceExpr':
      return 'coalesce';
    case 'MinMaxExpr':
      return body.op === 'IS_GREATEST' ? 'greatest' : 'least';
    case 'SQLValueFunction':
      return String(body.op)
        .replace(/^SVFOP_/, '')
        .replace(/_N$/, '')
        .toLowerCase();
    case 'SubLink':
      return body.subLinkType === 'EXISTS_SUBLINK' ? 'exists' : '?column?';
    case 'GroupingFunc':
      return 'grouping';
    default:
      return '?column?';
  }
}

function bareName(kind: string, body: Node): string | undefined {
  if (kind !== 'ColumnRef') {
    return undefined;
  }
  const parts = list(body.fields);
  return parts.length === 1 && isString(parts[0]) ? str(parts[0]) : undefined;
}

function starFields(node: unknown): unknown[] | null {
  if (!isObject(node) || !('ColumnRef' in node)) {
    return null;
  }
  const parts = list((node.ColumnRef as Node).fields);
  const last = parts[parts.length - 1];
  return isObject(last) && 'A_Star' in last ? parts : null;
}

function findRef(
  refname: string,
  scope: Scope,
): { entry: Entry; level: Scope } | undefined {
  for (let level: Scope | null = scope; level; level = level.parent) {
    const entry = level.entries.find((item) => item.refname === refname);
    if (entry) {
      return { entry, level };
    }
  }
  return undefined;
}

// A reference rewritten to owner.column has to mean the same thing at the reference's own
// level. If a closer level reuses the owner's name, PostgreSQL would pick that one instead.
function assertNotShadowed(entry: Entry, owner: Scope, from: Scope): void {
  for (let level: Scope | null = from; level && level !== owner; level = level.parent) {
    if (level.entries.some((item) => item.refname === entry.refname)) {
      throw new Rejection(
        'ambiguous_reference',
        `A column here belongs to ${show(entry.refname)} in an outer query, but an inner query also uses the name ${show(entry.refname)}. Use different aliases.`,
      );
    }
  }
}

function checkColumn(entry: Entry, name: string): void {
  const columns = entry.columns.filter((column) => column.name === name);
  if (columns.length > 1) {
    throw new Rejection(
      'ambiguous_reference',
      `${show(`${entry.refname}.${name}`)} matches more than one column.`,
    );
  }
  if (columns.length === 0 || !columns[0]!.allowed) {
    throw notAllowed(entry, name);
  }
}

function notAllowed(entry: Entry, name: string): Rejection {
  return new Rejection(
    'column_not_allowed',
    `The column ${display(entry)}.${show(name)} is not on the allowlist.`,
  );
}

function display(entry: Entry): string {
  return entry.table
    ? show(`${entry.table.schema}.${entry.table.name}`)
    : show(entry.refname);
}

function catalogName(names: string[]): string | undefined {
  if (names.length === 1) {
    return names[0];
  }
  if (names.length === 2 && names[0] === 'pg_catalog') {
    return names[1];
  }
  return undefined;
}

function rename(outputs: string[], colnames: unknown): string[] {
  if (colnames === undefined) {
    return outputs;
  }
  const names = list(colnames).map(str);
  if (names.length > outputs.length) {
    throw unsupported('The alias lists more column names than the query has columns.');
  }
  return [...names, ...outputs.slice(names.length)];
}

function aliasOf(node: unknown): { name: string; colnames?: unknown } {
  const alias = node as Node;
  fields(alias, 'alias', ['aliasname', 'colnames']);
  return { name: String(alias.aliasname), colnames: alias.colnames };
}

function columnRef(refname: string, column: string): Node {
  return { ColumnRef: { fields: [stringNode(refname), stringNode(column)] } };
}

function stringNode(value: string): Node {
  return { String: { sval: value } };
}

function intValue(constant: Node): number | undefined {
  if (!isObject(constant.ival)) {
    return undefined;
  }
  const value = (constant.ival as Node).ival;
  // The parser leaves zero out of the JSON, so an empty ival is 0.
  return typeof value === 'number' ? value : 0;
}

function fields(body: Node, label: string, allowed: readonly string[]): void {
  for (const key of Object.keys(body)) {
    if (key !== 'location' && !allowed.includes(key)) {
      throw unsupported(`This ${label} uses ${key}, which is not supported.`);
    }
  }
}

function list(value: unknown): unknown[] {
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw unsupported('The query contains a construct the guard does not recognize.');
  }
  return value;
}

function isString(node: unknown): boolean {
  return isObject(node) && 'String' in node;
}

function str(node: unknown): string {
  const [kind, body] = unwrap(node);
  if (kind !== 'String' || typeof body.sval !== 'string') {
    throw unsupported('The query contains a construct the guard does not recognize.');
  }
  return body.sval;
}

function isObject(value: unknown): value is Node {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function tableKey(schema: string, name: string): string {
  return JSON.stringify([schema, name]);
}

function unsupported(reason: string): Rejection {
  return new Rejection('unsupported_syntax', reason);
}

const DESCRIPTIONS: Record<string, string> = {
  ParamRef: 'A parameter such as $1',
  A_ArrayExpr: 'An ARRAY constructor',
  A_Indirection: 'A subscript or field selection',
  CollateClause: 'COLLATE',
  RowExpr: 'A row constructor',
  XmlExpr: 'An XML expression',
  XmlSerialize: 'XMLSERIALIZE',
  RangeTableSample: 'TABLESAMPLE',
};

function describe(kind: string): string {
  return DESCRIPTIONS[kind] ?? (kind.startsWith('Json') ? 'A JSON expression' : kind);
}

/** Names come from the query, so they are shortened before going into a reason. */
export function show(name: string): string {
  return name.length > 64 ? `${name.slice(0, 64)}...` : name;
}
