import type * as TS from 'typescript';
import { absPosix } from '../util/paths.js';
import type { SymbolResolver } from './symbols.js';

/**
 * Limited static evaluator (plan sections 9 and 10).
 *
 * It evaluates values, it does not resolve names: identifier resolution is done
 * by the TypeChecker. Arbitrary function calls are never executed; the only
 * known call pattern is Angular's `forwardRef`.
 */

/**
 * The addressable name of a class-like declaration.
 *
 * An anonymous class is only reachable as `default` when it really is the
 * default export; every other anonymous class has no stable name, and treating
 * it as `default` would attribute its code to an unrelated component.
 */
export function classLikeName(ts: typeof TS, declaration: TS.ClassLikeDeclaration): string | null {
  if (declaration.name) return declaration.name.text;
  const modifiers = ts.canHaveModifiers(declaration) ? ts.getModifiers(declaration) : undefined;
  const isDefault = (modifiers ?? []).some((m) => m.kind === ts.SyntaxKind.DefaultKeyword);
  return isDefault ? 'default' : null;
}

export interface ClassRef {
  name: string;
  file: string;
  declaration: TS.ClassLikeDeclaration;
  symbol: TS.Symbol | undefined;
}

export type StaticValue =
  | { k: 'prim'; v: string | number | boolean | null | undefined }
  | { k: 'array'; items: StaticValue[] }
  | { k: 'object'; props: Map<string, StaticValue>; node: TS.ObjectLiteralExpression | null }
  | { k: 'class'; ref: ClassRef }
  | { k: 'unknown'; reason: string; node: TS.Node };

export const isUnknown = (value: StaticValue): value is Extract<StaticValue, { k: 'unknown' }> => value.k === 'unknown';

export function asString(value: StaticValue | undefined): string | null {
  return value && value.k === 'prim' && typeof value.v === 'string' ? value.v : null;
}

export function asBoolean(value: StaticValue | undefined): boolean | null {
  return value && value.k === 'prim' && typeof value.v === 'boolean' ? value.v : null;
}

export function objectGet(value: StaticValue | undefined, key: string): StaticValue | undefined {
  return value && value.k === 'object' ? value.props.get(key) : undefined;
}

/** Flattens arrays of arrays, keeping unknown markers so callers see the gap. */
export function flatten(value: StaticValue | undefined, out: StaticValue[] = []): StaticValue[] {
  if (!value) return out;
  if (value.k === 'array') {
    for (const item of value.items) flatten(item, out);
  } else {
    out.push(value);
  }
  return out;
}

export class StaticEvaluator {
  private readonly ts: typeof TS;
  private readonly visiting = new Set<TS.Node>();

  constructor(ts: typeof TS, private readonly symbols: SymbolResolver) {
    this.ts = ts;
  }

  evaluate(node: TS.Node | undefined): StaticValue {
    if (!node) return { k: 'unknown', reason: 'missing expression', node: node as unknown as TS.Node };
    if (this.visiting.has(node)) {
      return { k: 'unknown', reason: 'cyclic static value', node };
    }
    this.visiting.add(node);
    try {
      return this.evaluateNode(node);
    } finally {
      this.visiting.delete(node);
    }
  }

  private unknown(node: TS.Node, reason: string): StaticValue {
    return { k: 'unknown', reason, node };
  }

  private classRef(declaration: TS.ClassLikeDeclaration): StaticValue {
    const ts = this.ts;
    const name = classLikeName(ts, declaration);
    if (!name) return this.unknown(declaration, 'anonymous class');
    return {
      k: 'class',
      ref: {
        name,
        file: absPosix(declaration.getSourceFile().fileName),
        declaration,
        symbol: declaration.name
          ? this.symbols.symbolAt(declaration.name)
          : ts.isClassDeclaration(declaration)
            ? (declaration as unknown as { symbol?: TS.Symbol }).symbol
            : undefined,
      },
    };
  }

  private evaluateNode(node: TS.Node): StaticValue {
    const ts = this.ts;

    if (ts.isParenthesizedExpression(node)) return this.evaluate(node.expression);
    if (ts.isAsExpression(node) || ts.isSatisfiesExpression(node) || ts.isTypeAssertionExpression(node)) {
      return this.evaluate(node.expression);
    }
    if (ts.isNonNullExpression(node)) return this.evaluate(node.expression);

    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      return { k: 'prim', v: node.text };
    }
    if (ts.isNumericLiteral(node)) return { k: 'prim', v: Number(node.text) };
    if (node.kind === ts.SyntaxKind.TrueKeyword) return { k: 'prim', v: true };
    if (node.kind === ts.SyntaxKind.FalseKeyword) return { k: 'prim', v: false };
    if (node.kind === ts.SyntaxKind.NullKeyword) return { k: 'prim', v: null };
    if (ts.isIdentifier(node) && node.text === 'undefined') return { k: 'prim', v: undefined };

    if (ts.isPrefixUnaryExpression(node) && node.operator === ts.SyntaxKind.MinusToken) {
      const inner = this.evaluate(node.operand);
      if (inner.k === 'prim' && typeof inner.v === 'number') return { k: 'prim', v: -inner.v };
      return this.unknown(node, 'unary expression');
    }

    if (ts.isTemplateExpression(node)) {
      let text = node.head.text;
      for (const span of node.templateSpans) {
        const part = this.evaluate(span.expression);
        if (part.k !== 'prim' || part.v === null || part.v === undefined) {
          return this.unknown(node, 'template literal with dynamic parts');
        }
        text += String(part.v) + span.literal.text;
      }
      return { k: 'prim', v: text };
    }

    if (ts.isArrayLiteralExpression(node)) {
      const items: StaticValue[] = [];
      for (const element of node.elements) {
        if (ts.isSpreadElement(element)) {
          const spread = this.evaluate(element.expression);
          if (spread.k === 'array') items.push(...spread.items);
          else items.push(this.unknown(element, 'unresolved spread'));
          continue;
        }
        items.push(this.evaluate(element));
      }
      return { k: 'array', items };
    }

    if (ts.isObjectLiteralExpression(node)) {
      const props = new Map<string, StaticValue>();
      for (const property of node.properties) {
        if (ts.isSpreadAssignment(property)) {
          const spread = this.evaluate(property.expression);
          if (spread.k === 'object') {
            for (const [key, value] of spread.props) props.set(key, value);
          }
          continue;
        }
        const name = this.propertyName(property.name);
        if (name === null) continue;
        if (ts.isPropertyAssignment(property)) {
          props.set(name, this.evaluate(property.initializer));
        } else if (ts.isShorthandPropertyAssignment(property)) {
          props.set(name, this.evaluate(property.name));
        } else {
          props.set(name, this.unknown(property, 'method or accessor property'));
        }
      }
      return { k: 'object', props, node };
    }

    if (ts.isConditionalExpression(node)) {
      const condition = this.evaluate(node.condition);
      if (condition.k === 'prim' && typeof condition.v === 'boolean') {
        return this.evaluate(condition.v ? node.whenTrue : node.whenFalse);
      }
      return this.unknown(node, 'runtime conditional');
    }

    if (ts.isClassExpression(node)) return this.classRef(node);

    if (ts.isCallExpression(node)) return this.evaluateCall(node);

    if (ts.isIdentifier(node)) return this.evaluateIdentifier(node);

    if (ts.isPropertyAccessExpression(node)) {
      const target = this.evaluateIdentifierLike(node);
      if (target) return target;
      const object = this.evaluate(node.expression);
      if (object.k === 'object') {
        return object.props.get(node.name.text) ?? this.unknown(node, `property "${node.name.text}" is not statically known`);
      }
      return this.unknown(node, 'property access on a dynamic value');
    }

    if (ts.isElementAccessExpression(node)) {
      const index = this.evaluate(node.argumentExpression);
      if (index.k !== 'prim' || (typeof index.v !== 'string' && typeof index.v !== 'number')) {
        return this.unknown(node, 'dynamic index');
      }
      const object = this.evaluate(node.expression);
      if (object.k === 'object' && typeof index.v === 'string') {
        return object.props.get(index.v) ?? this.unknown(node, 'unknown key');
      }
      if (object.k === 'array' && typeof index.v === 'number') {
        return object.items[index.v] ?? this.unknown(node, 'index out of range');
      }
      return this.unknown(node, 'dynamic element access');
    }

    return this.unknown(node, `unsupported expression (${ts.SyntaxKind[node.kind]})`);
  }

  private propertyName(name: TS.PropertyName | undefined): string | null {
    const ts = this.ts;
    if (!name) return null;
    if (ts.isIdentifier(name) || ts.isPrivateIdentifier(name)) return name.text;
    if (ts.isStringLiteral(name) || ts.isNumericLiteral(name)) return name.text;
    if (ts.isComputedPropertyName(name)) {
      const value = this.evaluate(name.expression);
      if (value.k === 'prim' && (typeof value.v === 'string' || typeof value.v === 'number')) return String(value.v);
    }
    return null;
  }

  /** `forwardRef(() => Foo)` is the only call pattern ngmaze follows (plan section 9). */
  private evaluateCall(node: TS.CallExpression): StaticValue {
    const ts = this.ts;
    const callee = node.expression;
    const calleeSymbol = ts.isIdentifier(callee) || ts.isPropertyAccessExpression(callee)
      ? this.symbols.symbolAt(ts.isPropertyAccessExpression(callee) ? callee.name : callee)
      : undefined;

    if (this.symbols.isPackageExport(calleeSymbol, '@angular/core', 'forwardRef')) {
      const [argument] = node.arguments;
      if (argument && (ts.isArrowFunction(argument) || ts.isFunctionExpression(argument))) {
        const body = argument.body;
        if (ts.isBlock(body)) {
          const statement = body.statements.length === 1 ? body.statements[0] : undefined;
          if (statement && ts.isReturnStatement(statement) && statement.expression) {
            return this.evaluate(statement.expression);
          }
          return this.unknown(node, 'forwardRef body is not a single return');
        }
        return this.evaluate(body);
      }
      return this.unknown(node, 'forwardRef argument is not a function');
    }

    return this.unknown(node, 'function call is not statically evaluated');
  }

  /** Resolves identifiers and qualified names through the TypeChecker. */
  private evaluateIdentifier(node: TS.Identifier): StaticValue {
    const resolved = this.evaluateIdentifierLike(node);
    return resolved ?? this.unknown(node, `"${node.text}" is not a statically known value`);
  }

  private evaluateIdentifierLike(node: TS.Identifier | TS.PropertyAccessExpression): StaticValue | undefined {
    const ts = this.ts;
    const nameNode = ts.isPropertyAccessExpression(node) ? node.name : node;
    const symbol = this.symbols.symbolAt(nameNode);
    const declaration = this.symbols.declarationOf(symbol);
    if (!declaration) return undefined;

    if (ts.isClassDeclaration(declaration) || ts.isClassExpression(declaration)) {
      return this.classRef(declaration);
    }

    if (ts.isEnumMember(declaration)) {
      const value = this.ts.isEnumMember(declaration) ? declaration.initializer : undefined;
      if (value) return this.evaluate(value);
      return undefined;
    }

    if (ts.isVariableDeclaration(declaration)) {
      const list = declaration.parent;
      const isConst = ts.isVariableDeclarationList(list) && (list.flags & ts.NodeFlags.Const) !== 0;
      if (!declaration.initializer) return undefined;
      if (!isConst) return { k: 'unknown', reason: 'value comes from a mutable binding', node };
      if (!this.symbols.isInternalFile(absPosix(declaration.getSourceFile().fileName))) {
        return { k: 'unknown', reason: 'value comes from an external package', node };
      }
      return this.evaluate(declaration.initializer);
    }

    if (ts.isPropertyDeclaration(declaration) && declaration.initializer) {
      return this.evaluate(declaration.initializer);
    }

    if (ts.isPropertyAssignment(declaration)) {
      return this.evaluate(declaration.initializer);
    }

    return undefined;
  }
}
