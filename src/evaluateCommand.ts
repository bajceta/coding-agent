export function evaluateCommandMode(command) {
    const cmd = command.trim();

    if (!cmd) {
        return 'run';
    }

    // Check for write operations (output redirection)
    if (
        />=|>>|<</.test(cmd) ||
        /\btee\b.*|echo\s+.+>\s+|\b(sed|awk)(\s+.*|-i\b)/i.test(cmd) ||
        /\bcat\b.*[>><]/i.test(cmd)
    ) {
        return 'write';
    }

    const readCommandPatterns = [
        /^git\s+(diff|status|log|show|blame|branch|tag|stash|remote)\s*/,
        /^cat\s|^head\s|^tail\s|^less\s|^more\s|^view\s/,
        /^grep\s|^egrep\s|^fgrep\s|^rg\s|^ag\s/,
        /^ls\s*|^ll\s*|^dir\s*|^tree\s*/,
        /^find\s.*(?:-name|-type|-perm|-user|-group|-mtime|-size|-empty)\b.*$/,
        /^pwd\s*|^who\s*|^date\s*|^uptime\s*|^df\s*|^free\s*|^ps\s*|^top\s*|^htop\s*/,
        /^ping\s|^traceroute\s|^tracert\s|^nslookup\s|^dig\s|^curl\s+-s\s|^wget\s+-O\s|^curl\s+-o\s+(\/dev\/null|null)/i,
        /(?:\s|^)--version\b|(?:\s|^)--help\b/,
        /^env\s*|^printenv\s*|^hostname\s*|^id\s*/,
        /^jobs\s*|^wait\s*|^njobs\s*/,
    ];

    for (const pattern of readCommandPatterns) {
        if (pattern.test(cmd)) {
            return 'read';
        }
    }

    const writeCommandPatterns = [
        /^touch\b/,
        /^mkdir\s+-p?\s*/,
        /^ln\s+-s\s/,
        /^cp\s/,
        /^mv\s/,
        /^rm\b/,
    ];

    for (const pattern of writeCommandPatterns) {
        if (pattern.test(cmd)) {
            return 'write';
        }
    }

    return 'run';
}
