import assert from 'node:assert/strict';
import { cleanName, initials } from '../src/names.js';
it('cleanName trims', () => assert.equal(cleanName('  Jeff '), 'Jeff'));
it('initials two parts', () => assert.equal(initials('Jeff Public'), 'J.P.'));
