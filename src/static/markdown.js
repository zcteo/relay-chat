(function(){
  function escapeHtml(s){
    return String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function inlineMarkdown(text){
    let s = escapeHtml(text);
    const codes = [];
    s = s.replace(/`([^`]+)`/g, (_, code) => {
      const token = `\u0000CODE${codes.length}\u0000`;
      codes.push(`<code>${code}</code>`);
      return token;
    });
    s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
    s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    s = s.replace(/__([^_]+)__/g, '<strong>$1</strong>');
    s = s.replace(/(^|\W)\*([^*\n]+)\*(?=\W|$)/g, '$1<em>$2</em>');
    s = s.replace(/(^|\W)_([^_\n]+)_(?=\W|$)/g, '$1<em>$2</em>');
    codes.forEach((html, i) => { s = s.replace(`\u0000CODE${i}\u0000`, html); });
    return s;
  }

  function flushParagraph(out, para){
    if (!para.length) return;
    out.push(`<p>${inlineMarkdown(para.join('\n')).replace(/\n/g, '<br>')}</p>`);
    para.length = 0;
  }

  function renderMarkdown(md){
    const lines = String(md ?? '').replace(/\r\n?/g, '\n').split('\n');
    const out = [];
    const para = [];
    let inCode = false;
    let codeLang = '';
    let code = [];
    let listType = null;
    let listItems = [];

    function flushList(){
      if (!listType) return;
      out.push(`<${listType}>${listItems.map(x => `<li>${inlineMarkdown(x)}</li>`).join('')}</${listType}>`);
      listType = null;
      listItems = [];
    }

    for (const line of lines) {
      const fence = line.match(/^```\s*([^`]*)\s*$/);
      if (fence) {
        if (inCode) {
          out.push(`<pre><code${codeLang ? ` class="language-${escapeHtml(codeLang)}"` : ''}>${escapeHtml(code.join('\n'))}</code></pre>`);
          inCode = false; codeLang = ''; code = [];
        } else {
          flushParagraph(out, para); flushList();
          inCode = true; codeLang = fence[1].trim(); code = [];
        }
        continue;
      }
      if (inCode) { code.push(line); continue; }

      if (!line.trim()) { flushParagraph(out, para); flushList(); continue; }

      const heading = line.match(/^(#{1,6})\s+(.+)$/);
      if (heading) {
        flushParagraph(out, para); flushList();
        const level = heading[1].length;
        out.push(`<h${level}>${inlineMarkdown(heading[2].trim())}</h${level}>`);
        continue;
      }

      const quote = line.match(/^>\s?(.*)$/);
      if (quote) {
        flushParagraph(out, para); flushList();
        out.push(`<blockquote>${inlineMarkdown(quote[1])}</blockquote>`);
        continue;
      }

      const ul = line.match(/^\s*[-*+]\s+(.+)$/);
      if (ul) {
        flushParagraph(out, para);
        if (listType && listType !== 'ul') flushList();
        listType = 'ul'; listItems.push(ul[1]);
        continue;
      }

      const ol = line.match(/^\s*\d+\.\s+(.+)$/);
      if (ol) {
        flushParagraph(out, para);
        if (listType && listType !== 'ol') flushList();
        listType = 'ol'; listItems.push(ol[1]);
        continue;
      }

      flushList();
      para.push(line);
    }
    if (inCode) out.push(`<pre><code${codeLang ? ` class="language-${escapeHtml(codeLang)}"` : ''}>${escapeHtml(code.join('\n'))}</code></pre>`);
    flushParagraph(out, para);
    flushList();
    return out.join('\n');
  }

  window.MarkdownLite = { render: renderMarkdown, escapeHtml };
})();
