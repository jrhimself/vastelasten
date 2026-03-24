import js from '@eslint/js';
import globals from 'globals';

export default [
  // Shared recommended rules for all JS files
  js.configs.recommended,

  // Browser globals for frontend code
  // Note: app.js exposes many functions as window globals called from HTML onclick
  // handlers — ESLint can't see those call sites, so no-unused-vars is downgraded
  // to a warning for this file.
  {
    files: ['public/**/*.js'],
    languageOptions: {
      globals: {
        ...globals.browser,
        Chart: 'readonly', // Chart.js loaded via <script> tag
      },
    },
    rules: {
      'no-unused-vars': 'warn',
    },
  },

  // Node/Worker globals for backend and lib code
  {
    files: ['functions/**/*.js', 'lib/**/*.js'],
    languageOptions: {
      globals: globals.node,
    },
  },

  // Test files — Vitest globals
  {
    files: ['test/**/*.js'],
    languageOptions: {
      globals: {
        ...globals.node,
        describe: 'readonly',
        it: 'readonly',
        expect: 'readonly',
        beforeEach: 'readonly',
      },
    },
  },

  // Ignore build artifacts and vendored libraries
  {
    ignores: ['public/chart.min.js', 'node_modules/**'],
  },
];
