// Компактный и безопасный Markdown-рендерер без внешних зависимостей.
// Весь пользовательский/модельный текст экранируется, HTML из Markdown не пропускается.

export const escapeHtml = (s) =>
  String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

function emphasis(s) {
  return s
    .replace(/\*\*([^\n]+?)\*\*/g, "<strong>$1</strong>")
    .replace(/__([^\n]+?)__/g, "<strong>$1</strong>")
    .replace(/(^|[^*\w])\*(?!\s)([^*\n]*[^*\s])\*(?!\*)/g, "$1<em>$2</em>")
    .replace(/(^|[^_\w])_(?!\s)([^_\n]*[^_\s])_(?![_\w])/g, "$1<em>$2</em>")
    .replace(/~~([^\n]+?)~~/g, "<del>$1</del>");
}

function inline(raw) {
  const holders = [];
  const hold = (html) => {
    holders.push(html);
    return `\u0000${holders.length - 1}\u0000`;
  };

  let s = String(raw).replace(/\u0000/g, "");

  // `код`
  s = s.replace(/`([^`\n]+)`/g, (_, c) => hold(`<code class="inline-code">${escapeHtml(c)}</code>`));

  s = escapeHtml(s);

  // [текст](https://url)
  s = s.replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+|mailto:[^\s)]+)\)/g, (_, text, url) =>
    hold(`<a href="${url}" target="_blank" rel="noopener noreferrer">${emphasis(text)}</a>`),
  );

  // Голые ссылки
  s = s.replace(/(^|[\s(])(https?:\/\/[^\s<]+[^\s<.,;:!?)\]])/g, (_, pre, url) =>
    `${pre}${hold(`<a href="${url}" target="_blank" rel="noopener noreferrer">${url}</a>`)}`,
  );

  s = emphasis(s);

  return s.replace(/\u0000(\d+)\u0000/g, (_, i) => holders[Number(i)]);
}

function codeBlock(code, lang) {
  const label = lang ? escapeHtml(lang) : "code";
  return (
    `<div class="code-block"><div class="code-head"><span class="code-lang">${label}</span>` +
    `<button class="code-copy" type="button">Копировать</button></div>` +
    `<pre><code>${escapeHtml(code)}</code></pre></div>`
  );
}

const RE_FENCE = /^\s*(`{3,}|~{3,})\s*([^\s`]*).*$/;
const RE_HEADING = /^(#{1,6})\s+(.+?)\s*#*\s*$/;
const RE_HR = /^\s{0,3}([-*_])(\s*\1){2,}\s*$/;
const RE_QUOTE = /^\s{0,3}>\s?/;
const RE_LIST = /^(\s*)([-*+]|\d{1,9}[.)])\s+(.*)$/;
const RE_TABLE_SEP = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;

function splitRow(line) {
  let t = line.trim();
  if (t.startsWith("|")) t = t.slice(1);
  if (t.endsWith("|")) t = t.slice(0, -1);
  return t.split("|").map((c) => c.trim());
}

function isTableStart(lines, i) {
  return (
    i + 1 < lines.length &&
    lines[i].includes("|") &&
    lines[i + 1].includes("|") &&
    RE_TABLE_SEP.test(lines[i + 1])
  );
}

function isBlockStart(lines, i) {
  const l = lines[i];
  return (
    RE_FENCE.test(l) ||
    RE_HEADING.test(l) ||
    RE_HR.test(l) ||
    RE_QUOTE.test(l) ||
    RE_LIST.test(l) ||
    isTableStart(lines, i)
  );
}

function renderList(items, pos) {
  const base = items[pos.i].indent;
  const ordered = items[pos.i].ordered;
  const tag = ordered ? "ol" : "ul";
  const start = items[pos.i].start;
  let html = `<${tag}${ordered && start > 1 ? ` start="${start}"` : ""}>`;
  while (pos.i < items.length && items[pos.i].indent >= base) {
    const it = items[pos.i];
    pos.i++;
    let inner = it.text
      .split("\n")
      .map((l) => inline(l))
      .join("<br>");
    if (pos.i < items.length && items[pos.i].indent > base) {
      inner += renderList(items, pos);
    }
    html += `<li>${inner}</li>`;
    if (pos.i < items.length && items[pos.i].indent === base && items[pos.i].ordered !== ordered) break;
  }
  return html + `</${tag}>`;
}

function blocks(lines) {
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    if (!line.trim()) {
      i++;
      continue;
    }

    // Блок кода (незакрытый блок во время стриминга тоже отображается)
    let m = line.match(RE_FENCE);
    if (m) {
      const fenceChar = m[1][0];
      const fenceLen = m[1].length;
      const closing = new RegExp(`^\\s*\\${fenceChar}{${fenceLen},}\\s*$`);
      const buf = [];
      i++;
      while (i < lines.length && !closing.test(lines[i])) {
        buf.push(lines[i]);
        i++;
      }
      i++;
      out.push(codeBlock(buf.join("\n"), m[2]));
      continue;
    }

    m = line.match(RE_HEADING);
    if (m) {
      const level = m[1].length;
      out.push(`<h${level}>${inline(m[2])}</h${level}>`);
      i++;
      continue;
    }

    if (RE_HR.test(line)) {
      out.push("<hr>");
      i++;
      continue;
    }

    if (RE_QUOTE.test(line)) {
      const buf = [];
      while (i < lines.length && RE_QUOTE.test(lines[i])) {
        buf.push(lines[i].replace(RE_QUOTE, ""));
        i++;
      }
      out.push(`<blockquote>${blocks(buf)}</blockquote>`);
      continue;
    }

    if (isTableStart(lines, i)) {
      const head = splitRow(lines[i]);
      const aligns = splitRow(lines[i + 1]).map((c) => {
        const l = c.startsWith(":");
        const r = c.endsWith(":");
        return l && r ? "center" : r ? "right" : l ? "left" : "";
      });
      i += 2;
      const rows = [];
      while (i < lines.length && lines[i].trim() && lines[i].includes("|")) {
        rows.push(splitRow(lines[i]));
        i++;
      }
      const cell = (tag, text, idx) =>
        `<${tag}${aligns[idx] ? ` style="text-align:${aligns[idx]}"` : ""}>${inline(text || "")}</${tag}>`;
      out.push(
        `<div class="table-wrap"><table><thead><tr>${head.map((c, k) => cell("th", c, k)).join("")}</tr></thead>` +
          `<tbody>${rows.map((r) => `<tr>${head.map((_, k) => cell("td", r[k], k)).join("")}</tr>`).join("")}</tbody></table></div>`,
      );
      continue;
    }

    m = line.match(RE_LIST);
    if (m) {
      const items = [];
      while (i < lines.length) {
        const lm = lines[i].match(RE_LIST);
        if (lm) {
          const marker = lm[2];
          items.push({
            indent: lm[1].replace(/\t/g, "    ").length,
            ordered: /\d/.test(marker),
            start: parseInt(marker, 10) || 1,
            text: lm[3],
          });
          i++;
        } else if (items.length && lines[i].trim() && /^\s{2,}\S/.test(lines[i]) && !RE_FENCE.test(lines[i])) {
          items[items.length - 1].text += "\n" + lines[i].trim();
          i++;
        } else if (
          items.length &&
          !lines[i].trim() &&
          i + 1 < lines.length &&
          RE_LIST.test(lines[i + 1])
        ) {
          i++;
        } else {
          break;
        }
      }
      const pos = { i: 0 };
      while (pos.i < items.length) out.push(renderList(items, pos));
      continue;
    }

    // Абзац
    const buf = [line];
    i++;
    while (i < lines.length && lines[i].trim() && !isBlockStart(lines, i)) {
      buf.push(lines[i]);
      i++;
    }
    out.push(`<p>${buf.map((l) => inline(l)).join("<br>")}</p>`);
  }
  return out.join("");
}

export function renderMarkdown(src) {
  const lines = String(src ?? "").replace(/\r\n?/g, "\n").split("\n");
  return blocks(lines);
}
