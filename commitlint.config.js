/**
 * Conventional Commits enforcement (see CONTRIBUTING.md).
 * Enforced locally by the .husky/commit-msg hook and in CI by the
 * "Commit lint" job in .github/workflows/quality-gates.yml.
 * @type {import('@commitlint/types').UserConfig}
 */
module.exports = {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'type-enum': [
      2,
      'always',
      ['feat', 'fix', 'docs', 'style', 'refactor', 'perf', 'test', 'build', 'ci', 'chore', 'revert'],
    ],
    // Scopes mirror the workspaces / subsystems. Optional (a scope-less
    // `feat: ...` is allowed), but if present it must be one of these.
    'scope-enum': [
      2,
      'always',
      ['bot', 'mini-app', 'miniapp', 'shared', 'db', 'ops', 'docs', 'ci', 'deps', 'release', 'portfolio'],
    ],
    'scope-empty': [0],
    'subject-case': [2, 'never', ['upper-case', 'pascal-case', 'start-case']],
    'header-max-length': [2, 'always', 100],
    'body-max-line-length': [0],
  },
};
