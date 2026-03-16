// SPDX-License-Identifier: AGPL-3.0-only

export default {
    extends: ['@commitlint/config-conventional'],

    plugins: [
        {
            rules: {
                'no-co-authored-by': ({ raw }) => {
                    const hasTrailer = /^Co-Authored-By:/im.test(raw);
                    return [
                        !hasTrailer,
                        'Co-Authored-By trailer is not allowed. All commits must be attributed to their human author.',
                    ];
                },
                'no-signed-off-by': ({ raw }) => {
                    const hasTrailer = /^Signed-off-by:/im.test(raw);
                    return [
                        !hasTrailer,
                        'Signed-off-by trailer is not allowed.',
                    ];
                },
            },
        },
    ],

    rules: {
        // Block AI co-authorship and DCO trailers
        'no-co-authored-by': [2, 'always'],
        'no-signed-off-by': [2, 'always'],

        // Header: type(scope): subject — max 100 chars
        'header-max-length': [2, 'always', 100],

        // Body and footer: wrap at 100 chars
        'body-max-line-length': [2, 'always', 100],
        'footer-max-line-length': [2, 'always', 100],

        // Allowed types (Angular/Conventional Commits standard)
        'type-enum': [
            2,
            'always',
            [
                'feat',     // new feature
                'fix',      // bug fix
                'docs',     // documentation
                'style',    // formatting, no code change
                'refactor', // code restructuring
                'perf',     // performance improvement
                'test',     // adding or correcting tests
                'build',    // build system or dependencies
                'ci',       // CI configuration
                'chore',    // maintenance tasks
                'revert',   // reverting a previous commit
            ],
        ],

        // Scopes: enforce known package/project scopes
        'scope-enum': [
            2,
            'always',
            [
                'core',
                'aws',
                'gcp',
                'channel-slack',
                'channel-mcp',
                'channel-gchat',
                'tools-aws',
                'tools-gcp',
                'tools-github',
                'tools-jira',
                'cli',
                'deps',
                'release',
            ],
        ],
        'scope-empty': [1, 'never'], // warn if no scope (encourage but don't block)

        // Subject: lowercase, no period, imperative mood
        'subject-case': [2, 'never', ['sentence-case', 'start-case', 'pascal-case', 'upper-case']],
        'subject-full-stop': [2, 'never', '.'],
        'subject-empty': [2, 'never'],

        // Type: always lowercase
        'type-case': [2, 'always', 'lower-case'],
        'type-empty': [2, 'never'],

        // Body/footer: require blank line before
        'body-leading-blank': [2, 'always'],
        'footer-leading-blank': [2, 'always'],
    },
};
