import { expect, test } from 'vitest';
import { cleanName, initials } from './names';

test('cleanName trims', () => expect(cleanName('  Jeff ')).toBe('Jeff'));
test('initials two parts', () => expect(initials('Jeff Public')).toBe('J.P.'));
