export const colors = {
  // Brand
  primary: '#EA580C',
  primaryDark: '#C2410C',
  primarySoft: '#FFEDD5',
  secondary: '#0E7490',
  secondarySoft: '#E0F2FE',
  accent: '#F59E0B',
  gold: '#B45309',

  // Text
  ink: '#0B1220',
  foreground: '#101828',
  mutedForeground: '#5B6472',
  subtle: '#98A2B3',
  onPrimary: '#FFFFFF',

  // Surfaces
  background: '#FFF8F2',
  card: '#FFFFFF',
  surface: '#FFFFFF',
  muted: '#FFF2E8',
  border: '#F4E3D6',
  borderStrong: '#F7CDB2',
  overlay: 'rgba(11, 18, 32, 0.48)',

  // Semantic
  destructive: '#B42318',
  destructiveSoft: '#FEE4E2',
  success: '#067647',
  successSoft: '#DCFAE6',
  info: '#026AA2',
  infoSoft: '#D1E9FF',
  warningSoft: '#FEF0C7',
} as const;

export const spacing = { xxs: 2, xs: 4, sm: 8, md: 16, lg: 24, xl: 32, xxl: 48 } as const;

export const radius = { xs: 8, sm: 10, input: 14, card: 22, sheet: 28, pill: 999 } as const;

export const shadow = {
  card: {
    shadowColor: colors.ink,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.06,
    shadowRadius: 16,
    elevation: 2,
  },
  raised: {
    shadowColor: colors.ink,
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.18,
    shadowRadius: 28,
    elevation: 8,
  },
} as const;
