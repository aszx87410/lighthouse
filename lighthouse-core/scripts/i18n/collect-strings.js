#!/usr/bin/env node
/**
 * @license Copyright 2018 Google Inc. All Rights Reserved.
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in compliance with the License. You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
 * Unless required by applicable law or agreed to in writing, software distributed under the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the License for the specific language governing permissions and limitations under the License.
 */
'use strict';

/* eslint-disable no-console, max-len */

const fs = require('fs');
const path = require('path');
// @ts-ignore - TODO: https://github.com/DefinitelyTyped/DefinitelyTyped/pull/25410
const esprima = require('esprima');

const LH_ROOT = path.join(__dirname, '../../../');
const UISTRINGS_REGEX = /const UIStrings = (.|\s)*?\};\n/gim;

/**
 * @typedef ICUMessage
 * @property {string} message
 * @property {string} [description]
 */

const ignoredPathComponents = [
  '/.git',
  '/scripts',
  '/node_modules',
  '/renderer',
  '/test/',
  '-test.js',
];

const defaultDescriptions = {
  failureTitle: 'Show to users as the title of the audit when it is in a failing state.',
};

// @ts-ignore - waiting for esprima types, see above TODO
function computeDescription(ast, property, startRange) {
  const endRange = property.range[0];
  for (const comment of ast.comments || []) {
    if (comment.range[0] < startRange) continue;
    if (comment.range[0] > endRange) continue;
    return comment.value.replace('*', '').trim();
  }

  return defaultDescriptions[property.key.name];
}

/**
 * @param {string} dir
 * @param {Record<string, ICUMessage>} strings
 */
function collectAllStringsInDir(dir, strings = {}) {
  for (const name of fs.readdirSync(dir)) {
    const fullPath = path.join(dir, name);
    const relativePath = path.relative(LH_ROOT, fullPath);
    if (ignoredPathComponents.some(p => fullPath.includes(p))) continue;

    if (fs.statSync(fullPath).isDirectory()) {
      collectAllStringsInDir(fullPath, strings);
    } else {
      if (name.endsWith('.js')) {
        console.log('Collecting from', relativePath);
        const content = fs.readFileSync(fullPath, 'utf8');
        if (!UISTRINGS_REGEX.test(content)) continue;
        const exportVars = require(fullPath);
        if (!exportVars.UIStrings) throw new Error('UIStrings not exported');

        // @ts-ignore regex just matched
        const justUIStrings = content.match(UISTRINGS_REGEX)[0];
        // just parse the UIStrings substring to avoid ES version issues, save time, etc
        const ast = esprima.parse(justUIStrings, {comment: true, range: true});

        for (const stmt of ast.body) {
          if (stmt.type !== 'VariableDeclaration') continue;
          if (stmt.declarations[0].id.name !== 'UIStrings') continue;

          let lastPropertyEndIndex = 0;
          for (const property of stmt.declarations[0].init.properties) {
            const key = property.key.name;
            const message = exportVars.UIStrings[key];
            const description = computeDescription(ast, property, lastPropertyEndIndex);
            strings[`${relativePath} | ${key}`] = {message, description};
            lastPropertyEndIndex = property.range[1];
          }
        }
      }
    }
  }

  return strings;
}

/**
 * @param {Record<string, ICUMessage>} strings
 */
function createPsuedoLocaleStrings(strings) {
  const psuedoLocalizedStrings = {};
  for (const [key, defn] of Object.entries(strings)) {
    const message = defn.message;
    const psuedoLocalizedString = [];
    let braceCount = 0;
    let useHatForAccentMark = true;
    for (let i = 0; i < message.length; i++) {
      const char = message.substr(i, 1);
      psuedoLocalizedString.push(char);
      // Don't touch the characters inside braces
      if (char === '{') {
        braceCount++;
      } else if (char === '}') {
        braceCount--;
      } else if (braceCount === 0) {
        if (/[a-z]/i.test(char)) {
          psuedoLocalizedString.push(useHatForAccentMark ? `\u0302` : `\u0301`);
          useHatForAccentMark = !useHatForAccentMark;
        }
      }
    }

    psuedoLocalizedStrings[key] = {message: psuedoLocalizedString.join('')};
  }

  return psuedoLocalizedStrings;
}

/**
 * @param {LH.Locale} locale
 * @param {Record<string, ICUMessage>} strings
 */
function writeStringsToLocaleFormat(locale, strings) {
  const fullPath = path.join(LH_ROOT, `lighthouse-core/lib/locales/${locale}.json`);
  const output = {};
  for (const [key, object] of Object.entries(strings)) {
    output[key] = object;
  }

  fs.writeFileSync(fullPath, JSON.stringify(output, null, 2) + '\n');
}

const strings = collectAllStringsInDir(path.join(LH_ROOT, 'lighthouse-core'));
const psuedoLocalizedStrings = createPsuedoLocaleStrings(strings);
console.log('Collected!');

writeStringsToLocaleFormat('en-US', strings);
writeStringsToLocaleFormat('en-XA', psuedoLocalizedStrings);
console.log('Written to disk!');
