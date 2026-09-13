#!/usr/bin/env node
import { createRequire } from 'node:module';
import { CommanderError } from 'commander';
import { EXIT, UserError } from '../model/errors.js';
import { parseArgs } from './options.js';
import { run, type Io } from './run.js';

const require = createRequire(import.meta.url);
const { version } = require('../../package.json') as { version: string };

async function main(): Promise<number> {
  const io: Io = {
    stdout: (text) => process.stdout.write(text),
    stderr: (text) => process.stderr.write(text),
    isTty: Boolean(process.stdout.isTTY),
    env: process.env,
  };

  try {
    const options = parseArgs(process.argv.slice(2), version);
    return await run(options, io, version);
  } catch (error) {
    if (error instanceof CommanderError) {
      // --help / --version print through commander itself.
      if (error.code === 'commander.helpDisplayed' || error.code === 'commander.version' || error.code === 'commander.help') {
        return EXIT.OK;
      }
      process.stderr.write(`${error.message}\n`);
      return EXIT.USER_ERROR;
    }
    if (error instanceof UserError) {
      process.stderr.write(`${error.message}\n`);
      return error.exitCode;
    }
    // A stack trace is for a bug report, not for the user: keep the visible
    // message short and point at --verbose for the detail.
    const verbose = process.argv.includes('--verbose');
    const detail = error instanceof Error
      ? (verbose ? (error.stack ?? error.message) : error.message)
      : String(error);
    process.stderr.write(`ngmaze internal error: ${detail}\n`);
    if (!verbose) process.stderr.write('Rerun with --verbose for the stack trace, and please report it as an issue.\n');
    return EXIT.INTERNAL_ERROR;
  }
}

main().then((code) => {
  process.exitCode = code;
});
