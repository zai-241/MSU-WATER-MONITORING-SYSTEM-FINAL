"""Extract a .docx thesis into plain text for review, using only the Python standard library.

Usage:  python -I extract.py "<path to .docx>" "<output folder>"

Writes to the output folder:
  draft.txt       every non-empty paragraph as "[p123] text"; comment anchors appear as [[C5>]] ... [[<C5]]
  comments.txt    Word comments (if any) as "[C5] Author: text"
  highlights.txt  highlighted passages as "[p123] (yellow) text"
  outline.txt     heading-like lines (chapters, numbered sections) with paragraph numbers
"""
import html
import os
import re
import sys
import zipfile

# w:t is normal text; m:t is text inside Word equations (many numbers in the thesis are equations)
W_T = r'<[wm]:t(?:\s[^>]*)?>(.*?)</[wm]:t>'
HEADING = re.compile(r'^(CHAPTER|Chapter|ABSTRACT|REFERENCES|APPENDI|ACKNOWLEDG|\d+(\.\d+)+\.?\s+\S)')


def para_text(p):
    p = re.sub(r'<w:commentRangeStart [^>]*w:id="(\d+)"[^>]*/>', r'<w:t>[[C\1>]]</w:t>', p)
    p = re.sub(r'<w:commentRangeEnd [^>]*w:id="(\d+)"[^>]*/>', r'<w:t>[[<C\1]]</w:t>', p)
    p = p.replace('<w:tab/>', '<w:t>\t</w:t>')
    return html.unescape(''.join(re.findall(W_T, p, re.S)))


def paragraphs(xml):
    return re.findall(r'<w:p[ >].*?</w:p>', xml, re.S)


def main(src, out):
    os.makedirs(out, exist_ok=True)
    z = zipfile.ZipFile(src)
    paras = paragraphs(z.read('word/document.xml').decode('utf-8'))

    marked = []  # [paragraph number, color, text]
    with open(os.path.join(out, 'draft.txt'), 'w', encoding='utf-8') as d, \
         open(os.path.join(out, 'outline.txt'), 'w', encoding='utf-8') as o:
        for i, p in enumerate(paras):
            t = para_text(p)
            if not t.strip():
                continue
            d.write(f'[p{i}] {t}\n')
            if HEADING.match(t.strip()) and len(t) < 160:
                o.write(f'[p{i}] {t.strip()}\n')
            prev = None
            for r in re.findall(r'<w:r[ >].*?</w:r>', p, re.S):
                m = re.search(r'<w:highlight w:val="(\w+)"', r)
                color = m.group(1) if m and m.group(1) != 'none' else None
                rt = html.unescape(''.join(re.findall(W_T, r, re.S)))
                if color and prev == color:
                    marked[-1][2] += rt
                elif color:
                    marked.append([i, color, rt])
                prev = color

    marked = [m for m in marked if m[2].strip()]
    with open(os.path.join(out, 'highlights.txt'), 'w', encoding='utf-8') as h:
        for i, color, text in marked:
            h.write(f'[p{i}] ({color}) {text.strip()}\n')

    count = 0
    if 'word/comments.xml' in z.namelist():
        cx = z.read('word/comments.xml').decode('utf-8')
        with open(os.path.join(out, 'comments.txt'), 'w', encoding='utf-8') as c:
            for m in re.finditer(r'<w:comment\s([^>]*)>(.*?)</w:comment>', cx, re.S):
                attrs = m.group(1)
                cid = re.search(r'w:id="(\d+)"', attrs).group(1)
                author = re.search(r'w:author="([^"]*)"', attrs)
                body = ' '.join(para_text(p) for p in paragraphs(m.group(2))).strip()
                c.write(f'[C{cid}] {html.unescape(author.group(1)) if author else "?"}: {body}\n')
                count += 1

    print(f'{len(paras)} paragraphs, {count} comments, {len(marked)} highlighted passages -> {out}')


if __name__ == '__main__':
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    main(sys.argv[1], sys.argv[2])
