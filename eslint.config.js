import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**', 'ui/dist/**', '.worktrees/**', 'src/integrations/notify/spike/**'] },
  ...tseslint.configs.recommended,
);
