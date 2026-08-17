import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{js,jsx}'],
    extends: [
      js.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      globals: globals.browser,
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
  },
  {
    // Vercel serverless functions run on Node
    files: ['api/**/*.js'],
    languageOptions: { globals: globals.node },
  },
  {
    // Scriptable (iOS widget) provides its own globals
    files: ['widget/**/*.js'],
    languageOptions: {
      globals: {
        args: 'readonly', config: 'readonly', console: 'readonly',
        Alert: 'readonly', Color: 'readonly', DateFormatter: 'readonly',
        Device: 'readonly', FileManager: 'readonly', Font: 'readonly',
        Keychain: 'readonly', ListWidget: 'readonly', Request: 'readonly',
        Script: 'readonly',
      },
    },
  },
])
