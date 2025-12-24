import fs from 'fs';
import path from 'path';
import type { ExecuteResult } from '../interfaces.ts';

async function execute(
    _path: string,
    oldText: string,
    newText: string,
    options?: {
        caseSensitive?: boolean;
        wholeWord?: boolean;
        maxReplacements?: number;
        fuzzyMatch?: boolean;
        fuzzyThreshold?: number;
    },
): Promise<ExecuteResult> {
    try {
        const cwd = process.cwd();
        const resolvedPath = path.resolve(_path);

        // Check if path is within current working directory
        if (!resolvedPath.startsWith(cwd + path.sep) && resolvedPath !== cwd) {
            return {
                success: false,
                content: null,
                error: 'Path must be within the current working directory',
            };
        }

        const content = await fs.promises.readFile(resolvedPath, 'utf8');

        // Set default options
        const opts = {
            caseSensitive: true,
            wholeWord: false,
            maxReplacements: Infinity,
            fuzzyMatch: false,
            fuzzyThreshold: 0.8,
            ...options,
        };

        let newContent = content;
        let replacementsMade = 0;

        if (opts.fuzzyMatch) {
            // Fuzzy matching implementation
            const lines = content.split('\n');
            const newLines = [];

            for (const line of lines) {
                if (replacementsMade >= opts.maxReplacements) {
                    newLines.push(line);
                    continue;
                }

                // Simple fuzzy matching - check if text is contained with some tolerance
                let matchedLine = line;
                const searchText = opts.caseSensitive ? oldText : oldText.toLowerCase();
                const contentLine = opts.caseSensitive ? line : line.toLowerCase();

                // Find all occurrences and replace them
                const regex = new RegExp(searchText, opts.caseSensitive ? 'g' : 'gi');
                let match;
                let lastEnd = 0;
                let replacedLine = '';

                while (
                    (match = regex.exec(contentLine)) !== null &&
                    replacementsMade < opts.maxReplacements
                ) {
                    replacedLine += line.substring(lastEnd, match.index) + newText;
                    lastEnd = match.index + match[0].length;
                    replacementsMade++;
                }

                if (lastEnd < line.length) {
                    replacedLine += line.substring(lastEnd);
                }

                newLines.push(replacedLine);
            }

            newContent = newLines.join('\n');
        } else if (opts.wholeWord) {
            // For whole word matching, we need to use regex with word boundaries
            const flags = opts.caseSensitive ? 'g' : 'gi';
            const escapedOldText = oldText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const regex = new RegExp(`\\b${escapedOldText}\\b`, flags);

            // Replace with a function to track replacements
            newContent = content.replace(regex, (match) => {
                if (replacementsMade >= opts.maxReplacements) return match;
                replacementsMade++;
                return newText;
            });
        } else {
            // Standard replacement logic
            const searchPattern = opts.caseSensitive ? oldText : new RegExp(oldText, 'gi');

            // Replace with a function to track replacements
            newContent = content.replace(searchPattern, (match) => {
                if (replacementsMade >= opts.maxReplacements) return match;
                replacementsMade++;
                return newText;
            });
        }

        // If no replacements were made and we're not using fuzzy matching, check if the text exists
        if (replacementsMade === 0 && !opts.fuzzyMatch) {
            const searchContent = opts.caseSensitive ? content : content.toLowerCase();
            const searchText = opts.caseSensitive ? oldText : oldText.toLowerCase();

            if (!searchContent.includes(searchText)) {
                return {
                    success: false,
                    content: null,
                    error: `Text "${oldText}" not found in file ${resolvedPath}`,
                };
            }
        }

        await fs.promises.writeFile(resolvedPath, newContent, 'utf8');

        return {
            success: true,
            content: `Successfully replaced ${replacementsMade} occurrence(s) of text in ${resolvedPath}`,
            error: null,
        };
    } catch (error) {
        return {
            success: false,
            content: null,
            error: error.message,
        };
    }
}

// Export module
export default {
    description:
        'Enhanced flexible text replacement tool. Supports case-sensitive/insensitive matching, whole word matching, limiting replacements, and fuzzy matching. More forgiving for LLMs to use with varied input formats.',
    arguments: [
        { path: 'path to the file to modify' },
        { oldText: 'text to be replaced' },
        { newText: 'replacement text' },
        {
            options:
                'optional configuration object with caseSensitive, wholeWord, maxReplacements, fuzzyMatch, and fuzzyThreshold properties',
        },
    ],
    execute,
    enabled: false,
    safe: false,
};
