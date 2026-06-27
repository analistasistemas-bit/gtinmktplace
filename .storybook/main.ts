import type { StorybookConfig } from '@storybook/react-vite';

// O builder react-vite faz merge automático do vite.config.ts do projeto,
// herdando o plugin @tailwindcss/vite e o alias '@'. Nada a duplicar aqui.
const config: StorybookConfig = {
  stories: ['../src/**/*.stories.@(ts|tsx)'],
  addons: ['@storybook/addon-essentials', '@storybook/addon-themes'],
  framework: { name: '@storybook/react-vite', options: {} },
};

export default config;
