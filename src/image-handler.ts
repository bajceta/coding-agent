import * as fs from 'fs';
import * as path from 'path';

export interface ImageData {
    base64: string;
    mimeType: string;
    fileName: string;
}

export class ImageHandler {
    private loadedImageData: ImageData | null = null;

    /**
     * Loads an image file and converts it to base64 format
     */
    async loadImageToBase64(fileName: string): Promise<ImageData> {
        const fullPath = path.resolve(fileName);
        if (!fs.existsSync(fullPath)) {
            throw new Error(`Image file not found: ${fileName}`);
        }

        // Get file extension
        const ext = path.extname(fileName).toLowerCase();

        // Read file as buffer
        const imageBuffer = fs.readFileSync(fullPath);

        // Convert to base64
        const base64Image = imageBuffer.toString('base64');

        // Get MIME type
        const mimeType = this.getMimeType(ext);

        return {
            base64: base64Image,
            mimeType,
            fileName,
        };
    }

    /**
     * Returns the MIME type for a given file extension
     */
    getMimeType(extension: string): string {
        const mimeTypes: Record<string, string> = {
            '.png': 'image/png',
            '.jpg': 'image/jpeg',
            '.jpeg': 'image/jpeg',
            '.gif': 'image/gif',
            '.webp': 'image/webp',
            '.bmp': 'image/bmp',
            '.tiff': 'image/tiff',
            '.ico': 'image/x-icon',
        };
        return mimeTypes[extension] || 'image/jpeg';
    }

    /**
     * Retrieves the loaded image data and prepares it for the next LLM request
     * Returns null if no image is loaded
     */
    getLoadedImageData(): ImageData | null {
        return this.loadedImageData;
    }

    /**
     * Clears the loaded image from memory
     */
    clearLoadedImage(): void {
        if (this.loadedImageData) {
            this.loadedImageData = null;
        }
    }

    /**
     * Checks if an image is currently loaded
     */
    hasLoadedImage(): boolean {
        return this.loadedImageData !== null;
    }
}
