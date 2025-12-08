const textWithNewlines = 'Line 1\nLine 2\nLine 3';

// Method 1: Using replace with regex
const replacedWithBackslashN1 = textWithNewlines.replace(/\n/g, '\\\\n');
console.log('Method 1 result:', replacedWithBackslashN1);

// Method 2: Using replaceAll (ES2021+)
const replacedWithBackslashN2 = textWithNewlines.replaceAll('\n', '\\\\n');
console.log('Method 2 result:', replacedWithBackslashN2);

// If you want to convert actual newlines to literal \n strings:
const originalText = 'Line 1\nLine 2\nLine 3';
const literalBackslashN = originalText.replace(/\n/g, '\\\\n');
console.log('Literal backslash-n:', literalBackslashN);
