import * as fs from 'fs';
import * as path from 'path';
import Log from './log.ts';

const log = Log.get('file-handler');

export class FileHandler {
    /**
     * Handles the @filename syntax to load file contents as input.
     *
     * @param input - The input string starting with @
     * @returns A string with the file content, 'image' if an image was loaded,
     *          or undefined if there was an error
     */
    async handleFileInput(input: string): Promise<string | undefined> {
        const fileName = input.substring(1).trim();
        if (!fileName) {
            return undefined;
        }

        try {
            const fullPath = path.resolve(fileName);

            if (!fs.existsSync(fullPath)) {
                return undefined;
            }

            // Get file extension
            const ext = path.extname(fileName).toLowerCase();

            // Check if it's an image file
            const imageExtensions = [
                '.png',
                '.jpg',
                '.jpeg',
                '.gif',
                '.webp',
                '.bmp',
                '.tiff',
                '.ico',
            ];
            if (imageExtensions.includes(ext.toLowerCase())) {
                return 'image';
            } else {
                // Load as text file
                const fileContent = fs.readFileSync(fullPath, 'utf-8');
                return `filename: ${fileName}, content: ${fileContent}`;
            }
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            log.error(`Error processing @filename command: ${errorMessage}`);
            return undefined;
        }
    }

    /**
     * Checks if the input looks like a file reference (@filename)
     */
    isFileInput(input: string): boolean {
        return input.startsWith('@');
    }

    /**
     * Gets the file name from an @filename input
     */
    getFileNameFromInput(input: string): string {
        return input.substring(1).trim();
    }

    /**
     * Checks if a file exists
     */
    async fileExists(fileName: string): Promise<boolean> {
        try {
            const fullPath = path.resolve(fileName);
            return fs.existsSync(fullPath);
        } catch {
            return false;
        }
    }

    /**
     * Reads the content of a text file
     */
    async readTextFile(fileName: string): Promise<string> {
        const fullPath = path.resolve(fileName);
        return fs.readFileSync(fullPath, 'utf-8');
    }

    /**
     * Checks if a file extension indicates an image
     */
    isImageFile(fileName: string): boolean {
        const ext = path.extname(fileName).toLowerCase();
        const imageExtensions = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.tiff', '.ico'];
        return imageExtensions.includes(ext);
    }
}
