#!/usr/bin/env node
/**
 * Lightweight, repeatable candidate census for Angular constructs that can
 * hide component relationships. It deliberately does not claim semantic
 * resolution: ngmaze's TypeScript analysis remains the source of truth.
 *
 * Usage: node scripts/audit-angular-features.mjs /path/to/angular/source
 */
import fs from 'node:fs';
import path from 'node:path';

const target = process.argv[2];
if (!target) {
  process.stderr.write('Usage: node scripts/audit-angular-features.mjs <source-directory>\n');
  process.exitCode = 2;
} else if (!fs.existsSync(target) || !fs.statSync(target).isDirectory()) {
  process.stderr.write(`Source directory not found: ${target}\n`);
  process.exitCode = 2;
} else {
  const root = path.resolve(target);
  const files = [];
  let excludedTestFiles = 0;
  const excluded = new Set(['.angular', '.git', 'coverage', 'dist', 'node_modules', 'out-tsc']);

  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (!excluded.has(entry.name)) visit(file);
      } else if (entry.isFile() && /\.(?:ts|html)$/.test(entry.name)) {
        // Match ngmaze's production analysis boundary: TestBed usages should
        // not inflate dynamic-component candidates.
        if (/(?:\.spec|\.test)\.(?:ts|html)$/.test(entry.name) || /(?:^|[\\/])(testing|e2e|__tests__|__mocks__)(?:[\\/]|$)/.test(file)) {
          excludedTestFiles++;
        } else {
          files.push(file);
        }
      }
    }
  };

  visit(root);
  files.sort();

  const checks = [
    ['router-outlet', 'Router outlet', /<router-outlet\b/g],
    ['ng-component-outlet', 'NgComponentOutlet', /\bngComponentOutlet\b/g],
    ['dynamic-create-component', 'createComponent', /\bcreateComponent\s*\(/g],
    ['view-container', 'ViewContainerRef', /\bViewContainerRef\b/g],
    ['load-component', 'Router loadComponent', /\bloadComponent\s*:/g],
    ['load-children', 'Router loadChildren', /\bloadChildren\s*:/g],
    ['bootstrap-application', 'bootstrapApplication', /\bbootstrapApplication\s*\(/g],
    ['ng-module-bootstrap', 'NgModule bootstrap', /\bbootstrap\s*:/g],
    ['angular-elements', 'Angular Elements', /\bcreateCustomElement\s*\(/g],
    ['host-directives', 'hostDirectives', /\bhostDirectives\s*:/g],
    ['content-projection', 'Content projection', /<ng-content\b/g],
    ['ng-template-outlet', 'NgTemplateOutlet', /\bngTemplateOutlet\b/g],
    ['embedded-view', 'Embedded view', /\bcreateEmbeddedView\s*\(/g],
    ['legacy-component-factory', 'ComponentFactoryResolver', /\bComponentFactoryResolver\b/g],
    ['runtime-compiler', 'Runtime Compiler', /\bCompiler\b/g],
    ['complex-extends', 'Complex extends', /\bextends\s+[A-Za-z_$][\w$]*\s*\(/g],
  ];

  const features = checks.map(([id, label, pattern]) => {
    const occurrences = [];
    for (const file of files) {
      const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
      for (let index = 0; index < lines.length; index++) {
        pattern.lastIndex = 0;
        const matches = lines[index].match(pattern);
        if (matches?.length) occurrences.push({ file: path.relative(root, file).split(path.sep).join('/'), line: index + 1, count: matches.length });
      }
    }
    return { id, label, files: new Set(occurrences.map((item) => item.file)).size, occurrences };
  });

  process.stdout.write(`${JSON.stringify({ root, scannedFiles: files.length, excludedTestFiles, features }, null, 2)}\n`);
}
