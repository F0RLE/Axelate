import { marked } from 'marked';
import markedAlert from 'marked-alert';
import markedFootnote from 'marked-footnote';

type ChatTranslate = (
    key: string,
    defaultValue?: string,
    params?: Record<string, unknown>,
) => string;

marked.use(markedAlert());
marked.use(markedFootnote());
marked.use({
    breaks: true,
    gfm: true,
});

export function configureChatMarkdown(translate: ChatTranslate): void {
    const renderer = new marked.Renderer();
    renderer.code = function ({
        text,
        lang,
        escaped,
    }: {
        text: string;
        lang?: string;
        escaped?: boolean;
    }): string {
        const language = lang ?? 'text';
        return `
             <div class="code-block-wrapper">
                 <div class="code-block-header">
                     <span class="code-lang">${language}</span>
                     <button class="code-copy-btn" title="${translate('ui.launcher.web.copy_code', 'Copy code')}">
                        <svg class="icon-copy" viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
                            <path d="M4 6h2v14H4zm2 14h12v2H6zM18 6h2v14h-2zM6 4h2v2H6zm10 0h2v2h-2zm-6-2h4v2h-4zm0 4h4v2h-4zM8 2h2v6H8zm6 0h2v6h-2z"></path>
                        </svg>
                        <span>${translate('ui.launcher.web.copy', 'Copy')}</span>
                     </button>
                 </div>
                 <pre><code class="language-${language}">${escaped === true ? text : text.replaceAll('<', '&lt;').replaceAll('>', '&gt;')}</code></pre>
             </div>
             `;
    };

    marked.use({ renderer });
}
