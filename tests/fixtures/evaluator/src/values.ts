import { forwardRef } from '@angular/core';
import { CONFIG, ExportedClass, NAME, NUMBERS } from './constants';

function runtime(): string {
  return 'runtime';
}

function forwardRefLookalike<T>(fn: () => T): T {
  return fn();
}

class LocalClass {}

const LOCAL = 'local';
let mutable = 'mutable';

export const samples = {
  stringLiteral: 'text',
  templateLiteral: `no-substitution`,
  numberLiteral: 42,
  negativeNumber: -7,
  booleanLiteral: true,
  nullLiteral: null,
  localConst: LOCAL,
  importedConst: NAME,
  mutableBinding: mutable,
  array: [1, 2, [3]],
  spreadArray: [...NUMBERS, 3],
  object: { a: 1, b: 'two' },
  spreadObject: { ...{ a: 1 }, b: 2 },
  propertyAccess: CONFIG.nested.value,
  elementAccess: NUMBERS[1],
  asConst: 'as-const' as const,
  satisfies: 'satisfied' satisfies string,
  parenthesized: ('parens'),
  staticConditional: true ? 'yes' : 'no',
  runtimeConditional: runtime() === 'x' ? 'yes' : 'no',
  functionCall: runtime(),
  localClass: LocalClass,
  importedClass: ExportedClass,
  forwardRef: forwardRef(() => ExportedClass),
  forwardRefBlock: forwardRef(() => {
    return ExportedClass;
  }),
  fakeForwardRef: forwardRefLookalike(() => ExportedClass),
};
