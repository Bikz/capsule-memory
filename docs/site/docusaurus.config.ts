import type { Config } from '@docusaurus/types';
import { themes } from 'prism-react-renderer';

const config: Config = {
  title: 'Capsule Memory',
  tagline: 'Production-ready memory-as-a-service for AI agents',
  url: 'https://docs.capsulememory.com',
  baseUrl: '/',
  favicon: 'img/favicon.ico',
  organizationName: 'capsule-memory',
  projectName: 'capsule-memory-docs',
  onBrokenLinks: 'warn',
  onBrokenMarkdownLinks: 'warn',
  trailingSlash: false,
  presets: [
    [
      'classic',
      {
        docs: {
          sidebarPath: require.resolve('./sidebars.ts'),
          routeBasePath: '/',
        },
        blog: false,
        theme: {
          customCss: require.resolve('./src/css/custom.css'),
        },
      },
    ],
  ],
  themeConfig: {
    image: 'img/social-card.png',
    navbar: {
      title: 'Capsule Memory',
      items: [
        { to: '/', label: 'Docs', position: 'left' },
        {
          href: 'https://github.com/capsule-memory/capsule-memory',
          label: 'GitHub',
          position: 'right',
        },
      ],
    },
    prism: {
      theme: themes.dracula,
      darkTheme: themes.dracula,
    },
  },
};

export default config;
