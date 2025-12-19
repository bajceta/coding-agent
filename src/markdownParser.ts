class MarkdownParser {
    static parse(text: string): string {
        if (!text) return text;
        
        // Process markdown elements in order of precedence
        let result = text;
        
        // Parse headers (# Header, ## Header, ### Header)
        result = this.parseHeaders(result);
        
        // Parse bold text (**bold** or __bold__)
        result = this.parseBold(result);
        
        // Parse italic text (*italic* or _italic_)
        result = this.parseItalic(result);
        
        // Parse code blocks (```code```)
        result = this.parseCodeBlocks(result);
        
        // Parse inline code (`code`)
        result = this.parseInlineCode(result);
        
        // Parse lists (- item or * item)
        result = this.parseLists(result);
        
        return result;
    }
    
    private static parseHeaders(text: string): string {
        // Match headers (# Header, ## Header, ### Header)
        return text.replace(/^(#{1,6})\s+(.*$)/gm, (match, hashes, content) => {
            const level = hashes.length;
            let colorCode = '';
            
            // Different colors for different header levels
            switch (level) {
                case 1: colorCode = '\x1b[1;35m'; break; // Magenta bold for H1
                case 2: colorCode = '\x1b[1;34m'; break; // Blue bold for H2
                case 3: colorCode = '\x1b[1;36m'; break; // Cyan bold for H3
                case 4: colorCode = '\x1b[1;32m'; break; // Green bold for H4
                case 5: colorCode = '\x1b[1;33m'; break; // Yellow bold for H5
                case 6: colorCode = '\x1b[1;37m'; break; // White bold for H6
                default: colorCode = '\x1b[1;37m';
            }
            
            return `${colorCode}${content}\x1b[0m`;
        });
    }
    
    private static parseBold(text: string): string {
        // Match **bold** or __bold__
        return text.replace(/\*\*(.*?)\*\*/g, '\x1b[1m$1\x1b[22m')  // Bold
                  .replace(/__(.*?)__/g, '\x1b[1m$1\x1b[22m');    // Bold with underscores
    }
    
    private static parseItalic(text: string): string {
        // Match *italic* or _italic_
        return text.replace(/\*(.*?)\*/g, '\x1b[3m$1\x1b[23m')   // Italic
                  .replace(/_(.*?)_/g, '\x1b[3m$1\x1b[23m');    // Italic with underscores
    }
    
    private static parseCodeBlocks(text: string): string {
        // Match ```code``` blocks
        return text.replace(/```([\s\S]*?)```/g, (match, code) => {
            // Simple code block formatting - light background
            return `\x1b[47m\x1b[30m${code}\x1b[0m`;
        });
    }
    
    private static parseInlineCode(text: string): string {
        // Match `code` inline
        return text.replace(/`([^`]+)`/g, '\x1b[47m\x1b[30m$1\x1b[0m');
    }
    
    private static parseLists(text: string): string {
        // Match list items (- item or * item)
        return text.replace(/^(?:[-*]\s+)(.*$)/gm, (match, content) => {
            // Add bullet point with color
            return `\x1b[32m•\x1b[0m ${content}`;
        });
    }
}

export default MarkdownParser;