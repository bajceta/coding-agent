#!/usr/bin/env node

const puppeteer = require('puppeteer');
const fs = require('fs').promises;
const TurndownService = require('turndown');

async function fetchWebpageAsMarkdown(url, outputFile = null) {
    let browser;
    try {
        // Launch browser
        browser = await puppeteer.launch({ headless: true });
        const page = await browser.newPage();

        // Set user agent to avoid being blocked
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');

        // Navigate to URL
        console.log(`Fetching ${url}...`);
        await page.goto(url, { waitUntil: 'networkidle0', timeout: 30000 });

        // Inject TurndownService into the browser context
        await page.addScriptTag({
            url: 'https://cdn.jsdelivr.net/npm/turndown@7.1.1/dist/turndown.min.js',
        });

        // Extract content as Markdown
        const markdownContent = await page.evaluate(() => {
            // Remove script and style elements
            document.querySelectorAll('script, style').forEach((el) => el.remove());

            // Get main content (you can customize this selector)
            const mainContent =
                document.querySelector('main') ||
                document.querySelector('article') ||
                document.querySelector('[role="main"]') ||
                document.body;

            // Use the TurndownService that was injected
            var td = new TurndownService();
            return td.turndown(mainContent.innerHTML);
        });

        // Add title to the beginning
        const title = await page.title();
        const finalContent = `# ${title}\n\n${markdownContent}`;

        // Save to file or output to console
        if (outputFile) {
            await fs.writeFile(outputFile, finalContent);
            console.log(`Markdown saved to ${outputFile}`);
        } else {
            console.log(finalContent);
        }
    } catch (error) {
        console.error('Error:', error.message);
        process.exit(1);
    } finally {
        if (browser) await browser.close();
    }
}

// Parse command line arguments
const args = process.argv.slice(2);
if (args.length < 1) {
    console.log('Usage: node webpage-to-md.js <URL> [output-file.md]');
    process.exit(1);
}

const url = args[0];
const outputFile = args[1];

fetchWebpageAsMarkdown(url, outputFile);
