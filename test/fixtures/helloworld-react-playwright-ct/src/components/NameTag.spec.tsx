import { test, expect } from '@playwright/experimental-ct-react';
import { NameTag } from './NameTag';

test('cleanName trims', async ({ mount }) => {
  const tag = await mount(<NameTag raw="  Jeff " />);
  await expect(tag.getByTestId('name')).toHaveText('Jeff');
});
test('initials two parts', async ({ mount }) => {
  const tag = await mount(<NameTag raw="Jeff Public" />);
  await expect(tag.getByTestId('initials')).toHaveText('J.P.');
});
