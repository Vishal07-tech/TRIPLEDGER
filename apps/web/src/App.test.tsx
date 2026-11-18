import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';

import App from './App';

describe('App', () => {
  it('renders landing page copy', () => {
    render(
      <MemoryRouter>
        <App />
      </MemoryRouter>,
    );

    expect(screen.getByText(/Travel smarter together/i)).toBeTruthy();
  });
});
