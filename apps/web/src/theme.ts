import {
  createTheme,
  darken,
  DEFAULT_THEME,
  type CSSVariablesResolver,
} from '@mantine/core';

/**
 * Mantine's defaults, adjusted to meet WCAG AA contrast (4.5:1 for normal text), as the
 * browser accessibility check found:
 * - primary buttons use blue 8: white on the default blue 6 is about 3.6:1, on blue 8 about 5:1;
 * - "dimmed" text uses gray 7 in light mode: the default gray 6 on white is about 3.3:1;
 * - text on "light" badges, buttons, and alerts is a darker shade of its colour in light
 *   mode: mid-tone text on a pale background of the same colour is too faint at badge size.
 * Dark mode keeps Mantine's colours, which pass.
 */
export const theme = createTheme({
  primaryShade: { light: 8, dark: 8 },
});

const LIGHT_VARIANT_COLORS = [
  'blue',
  'green',
  'red',
  'yellow',
  'orange',
  'teal',
  'grape',
  'cyan',
  'gray',
] as const;

export const cssVariablesResolver: CSSVariablesResolver = () => ({
  variables: {},
  light: {
    '--mantine-color-dimmed': 'var(--mantine-color-gray-7)',
    ...Object.fromEntries(
      LIGHT_VARIANT_COLORS.map((color) => [
        `--mantine-color-${color}-light-color`,
        darken(DEFAULT_THEME.colors[color][9], 0.3),
      ]),
    ),
  },
  dark: {},
});
