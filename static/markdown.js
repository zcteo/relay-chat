;(function () {
  function escapeHtml(s) {
    return String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;")
  }

  function inlineMarkdown(text) {
    let s = escapeHtml(text)
    const codes = []
    s = s.replace(/`([^`]+)`/g, (_, code) => {
      const token = `\u0000CODE${codes.length}\u0000`
      codes.push(`<code>${code}</code>`)
      return token
    })
    s = s.replace(
      /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
      '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>',
    )
    s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    s = s.replace(/__([^_]+)__/g, "<strong>$1</strong>")
    s = s.replace(/(^|\W)\*([^*\n]+)\*(?=\W|$)/g, "$1<em>$2</em>")
    s = s.replace(/(^|\W)_([^_\n]+)_(?=\W|$)/g, "$1<em>$2</em>")
    codes.forEach((html, i) => {
      s = s.replace(`\u0000CODE${i}\u0000`, html)
    })
    return s
  }

  function flushParagraph(out, para) {
    if (!para.length) return
    out.push(`<p>${inlineMarkdown(para.join("\n")).replace(/\n/g, "<br>")}</p>`)
    para.length = 0
  }

  function splitTableRow(line) {
    let s = String(line || "").trim()
    if (!s.includes("|")) return null
    if (s.startsWith("|")) s = s.slice(1)
    if (s.endsWith("|")) s = s.slice(0, -1)
    return s.split("|").map((cell) => cell.trim())
  }

  function parseTableSeparator(line) {
    const cells = splitTableRow(line)
    if (!cells || cells.length < 2) return null
    const aligns = []
    for (const cell of cells) {
      if (!/^:?-{3,}:?$/.test(cell)) return null
      const left = cell.startsWith(":")
      const right = cell.endsWith(":")
      aligns.push(
        left && right ? "center" : right ? "right" : left ? "left" : "",
      )
    }
    return aligns
  }

  function tableCellHtml(tag, value, align) {
    const attr = align ? ` style="text-align:${align}"` : ""
    return `<${tag}${attr}>${inlineMarkdown(value || "")}</${tag}>`
  }

  function tableHtml(header, aligns, rows) {
    const width = Math.max(header.length, aligns.length)
    const head = Array.from({ length: width }, (_, i) =>
      tableCellHtml("th", header[i] || "", aligns[i] || ""),
    ).join("")
    const body = rows
      .map((row) => {
        const cells = Array.from({ length: width }, (_, i) =>
          tableCellHtml("td", row[i] || "", aligns[i] || ""),
        ).join("")
        return `<tr>${cells}</tr>`
      })
      .join("")
    return `<div class="markdown-table"><table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`
  }

  function renderMarkdown(md) {
    const lines = String(md ?? "")
      .replace(/\r\n?/g, "\n")
      .split("\n")
    const out = []
    const para = []
    let inCode = false
    let codeLang = ""
    let code = []
    let codeFence = ""
    let codeFenceSize = 0
    let codeIndent = ""
    let listType = null
    let listItems = []

    function flushList() {
      if (!listType) return
      out.push(
        `<${listType}>${listItems.map((x) => `<li>${inlineMarkdown(x)}</li>`).join("")}</${listType}>`,
      )
      listType = null
      listItems = []
    }

    function codeBlockHtml() {
      return `<div class="code-block"><button class="copy-code" type="button" title="复制代码" aria-label="复制代码"><svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" aria-hidden="true" class="icon-md" viewBox="0 0 20 20" fill="none"><path d="M7 7.5C7 6.67 7.67 6 8.5 6H15c.83 0 1.5.67 1.5 1.5V15c0 .83-.67 1.5-1.5 1.5H8.5C7.67 16.5 7 15.83 7 15V7.5Z" stroke="currentColor" stroke-width="1.5"/><path d="M4 12.5V5c0-.83.67-1.5 1.5-1.5H12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg></button><pre><code${codeLang ? ` class="language-${escapeHtml(codeLang)}"` : ""}>${escapeHtml(code.join("\n"))}</code></pre></div>`
    }

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      const fence = line.match(/^([ \t]*)(`{3,}|~{3,})[ \t]*([^`~]*)[ \t]*$/)
      if (
        fence &&
        (!inCode ||
          (fence[2][0] === codeFence && fence[2].length >= codeFenceSize))
      ) {
        if (inCode) {
          out.push(codeBlockHtml())
          inCode = false
          codeLang = ""
          code = []
          codeFence = ""
          codeFenceSize = 0
          codeIndent = ""
        } else {
          flushParagraph(out, para)
          flushList()
          inCode = true
          codeLang = fence[3].trim()
          code = []
          codeFence = fence[2][0]
          codeFenceSize = fence[2].length
          codeIndent = fence[1]
        }
        continue
      }
      if (inCode) {
        code.push(
          codeIndent && line.startsWith(codeIndent)
            ? line.slice(codeIndent.length)
            : line,
        )
        continue
      }

      const header = splitTableRow(line)
      const aligns =
        i + 1 < lines.length ? parseTableSeparator(lines[i + 1]) : null
      if (header && aligns && header.length >= 2) {
        flushParagraph(out, para)
        flushList()
        const rows = []
        i += 2
        while (i < lines.length) {
          const row = splitTableRow(lines[i])
          if (!row) break
          rows.push(row)
          i += 1
        }
        i -= 1
        out.push(tableHtml(header, aligns, rows))
        continue
      }

      if (!line.trim()) {
        flushParagraph(out, para)
        flushList()
        continue
      }

      if (/^\s{0,3}(?:[-*_][ \t]*){3,}$/.test(line)) {
        flushParagraph(out, para)
        flushList()
        out.push("<hr>")
        continue
      }

      const heading = line.match(/^(#{1,6})\s+(.+)$/)
      if (heading) {
        flushParagraph(out, para)
        flushList()
        const level = heading[1].length
        out.push(`<h${level}>${inlineMarkdown(heading[2].trim())}</h${level}>`)
        continue
      }

      const quote = line.match(/^>\s?(.*)$/)
      if (quote) {
        flushParagraph(out, para)
        flushList()
        out.push(`<blockquote>${inlineMarkdown(quote[1])}</blockquote>`)
        continue
      }

      const ul = line.match(/^\s*[-*+]\s+(.+)$/)
      if (ul) {
        flushParagraph(out, para)
        if (listType && listType !== "ul") flushList()
        listType = "ul"
        listItems.push(ul[1])
        continue
      }

      const ol = line.match(/^\s*\d+\.\s+(.+)$/)
      if (ol) {
        flushParagraph(out, para)
        if (listType && listType !== "ol") flushList()
        listType = "ol"
        listItems.push(ol[1])
        continue
      }

      flushList()
      para.push(line)
    }
    if (inCode) out.push(codeBlockHtml())
    flushParagraph(out, para)
    flushList()
    return out.join("")
  }

  window.MarkdownLite = { render: renderMarkdown, escapeHtml }
})()
