import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';

import { ContactPage } from './ContactPage';

afterEach(cleanup);

it('disables contact submission when delivery is not configured', () => {
  render(<ContactPage available={false} />);
  expect(
    screen.getByText(
      'Contact delivery is not configured on this Beacon server.',
    ),
  ).toBeVisible();
  expect(screen.getByRole('button', { name: 'Unavailable' })).toBeDisabled();
  expect(screen.getByLabelText('Email')).toBeDisabled();
});
