/** Exit codes, plan section 34. */
export const EXIT = {
  OK: 0,
  NOT_FOUND: 1,
  AMBIGUOUS: 2,
  USER_ERROR: 3,
  INTERNAL_ERROR: 4,
} as const;

/** User side problem: CLI input, project/tsconfig resolution, output path. Exit 3. */
export class UserError extends Error {
  readonly exitCode = EXIT.USER_ERROR;
  constructor(message: string) {
    super(message);
    this.name = 'UserError';
  }
}
