module.exports = {
  preset: 'jest-expo',
  moduleNameMapper: {
    '^react$': '<rootDir>/node_modules/react',
    '^react/(.*)$': '<rootDir>/node_modules/react/$1',
  },
  testMatch: ['**/*.test.ts', '**/*.test.tsx'],
  clearMocks: true,
  restoreMocks: true,
  forceExit: true,
};
