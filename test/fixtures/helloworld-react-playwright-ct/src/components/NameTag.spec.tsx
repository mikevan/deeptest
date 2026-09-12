import { test, expect } from '../../.deeptest/witness-playwright';
import { NameTag } from './NameTag';

test('cleanName trims', async ({ mount }) => {
  const tag = await mount(<NameTag raw="  Jeff " />);
  await expect(tag.getByTestId('name')).toHaveText('Jeff');
});
test('initials two parts', async ({ mount }) => {
  const tag = await mount(<NameTag raw="Jeff Public" />);
  await expect(tag.getByTestId('initials')).toHaveText('J.P.');
});
