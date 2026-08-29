import { expect, it } from 'vitest';
import { packageName } from './index.js';

it('smoke: placeholder barrel exposes the package name', () => {
  expect(packageName).toBe('@seolite/cli');
});
