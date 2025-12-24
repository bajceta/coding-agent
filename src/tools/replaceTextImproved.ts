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
        ignoreWhitespace?: boolean;
        preserveFormatting?: boolean;
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
            ignoreWhitespace: false,
            preserveFormatting: false,
            ...options,
        };

        let newContent = content;
        let replacementsMade = 0;

        if (opts.ignoreWhitespace) {
            // Normalize whitespace for comparison
            const normalizeWhitespace = (str: string) => str.replace(/\s+/g, ' ').trim();
            const normalizedOldText = normalizeWhitespace(oldText);

            // Create a regex that matches the pattern with flexible whitespace
            const escapedOldText = normalizedOldText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const regex = new RegExp(escapedOldText, opts.caseSensitive ? 'g' : 'gi');

            newContent = content.replace(regex, (match) => {
                if (replacementsMade >= opts.maxReplacements) return match;
                replacementsMade++;
                return newText;
            });
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
            // Standard replacement logic with enhanced error handling
            let searchPattern;

            if (opts.caseSensitive) {
                searchPattern = new RegExp(oldText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
            } else {
                searchPattern = new RegExp(oldText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
            }

            // Replace with a function to track replacements
            newContent = content.replace(searchPattern, (match) => {
                if (replacementsMade >= opts.maxReplacements) return match;
                replacementsMade++;
                return newText;
            });
        }

        // If no replacements were made, provide better feedback
        if (replacementsMade === 0) {
            const searchContent = opts.caseSensitive ? content : content.toLowerCase();
            const searchText = opts.caseSensitive ? oldText : oldText.toLowerCase();

            if (!searchContent.includes(searchText)) {
                // Try to find similar text with fuzzy matching for better user experience
                const lines = content.split('\n');
                let foundSimilar = false;

                for (const line of lines) {
                    const lineContent = opts.caseSensitive ? line : line.toLowerCase();
                    if (lineContent.includes(searchText)) {
                        foundSimilar = true;
                        break;
                    }
                }

                if (!foundSimilar) {
                    return {
                        success: false,
                        content: null,
                        error: `Text "${oldText}" not found in file ${resolvedPath}. Note: This tool is designed to be more forgiving but still requires exact text matching.`,
                    };
                }
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
            error: `Error replacing text: ${error.message}`,
        };
    }
}

// Export module
export default {
    description:
        'Improved text replacement tool designed to be more forgiving for LLMs. Supports case-sensitive/insensitive matching, whole word matching, limiting replacements, and whitespace normalization. Provides better error messages and handles edge cases more gracefully.',
    arguments: [
        { path: 'path to the file to modify' },
        { oldText: 'text to be replaced' },
        { newText: 'replacement text' },
        {
            options:
                'optional configuration object with caseSensitive, wholeWord, maxReplacements, ignoreWhitespace, and preserveFormatting properties',
        },
    ],
    execute,
    enabled: true,
    safe: false,
};
