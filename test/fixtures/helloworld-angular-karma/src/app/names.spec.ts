
import { cleanName, initials } from './names';

it('cleanName trims', () => expect(cleanName('  Jeff ')).toBe('Jeff'));
it('initials two parts', () => expect(initials('Jeff Public')).toBe('J.P.'));
