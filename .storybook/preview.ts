import type { Preview } from '@storybook/react';
import { withThemeByClassName } from '@storybook/addon-themes';
import '../src/index.css';

const preview: Preview = {
  parameters: {
    controls: { matchers: { color: /(background|color)$/i, date: /Date$/i } },
    // O tema é controlado pela classe .dark no <html> (toolbar), não por backgrounds.
    backgrounds: { disable: true },
  },
  // Espelha o tema real do app: classe .dark no html, dark como padrão.
  decorators: [
    withThemeByClassName({
      themes: { light: '', dark: 'dark' },
      defaultTheme: 'dark',
    }),
  ],
};

export default preview;
