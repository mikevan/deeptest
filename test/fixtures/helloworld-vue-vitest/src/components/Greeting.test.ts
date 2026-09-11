import { mount } from '@vue/test-utils';
import { expect, test } from 'vitest';
import Greeting from './Greeting.vue';

test('Greeting renders the classic greeting', () => {
  const wrapper = mount(Greeting, { props: { name: 'Jeff' } });
  expect(wrapper.get('h1').text()).toBe('Hello, Jeff!');
});
