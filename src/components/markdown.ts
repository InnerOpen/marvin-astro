import { createMarkdownRenderer } from '../markdown.js';

/** The renderer Page/Article use when the site doesn't pass its own. */
export const defaultRenderMarkdown = createMarkdownRenderer();
