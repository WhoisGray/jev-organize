// Minimal, valid Office files from plain text, with no dependencies. Used to build the
// example company data and in tests. Word, Excel, PowerPoint, Pages, Numbers and Keynote
// open them.
import { writeZip } from '../src/extract/zip.mjs';

const x = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const NS = {
  ct: 'http://schemas.openxmlformats.org/package/2006/content-types',
  pr: 'http://schemas.openxmlformats.org/package/2006/relationships',
  r: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
  w: 'http://schemas.openxmlformats.org/wordprocessingml/2006/main',
  s: 'http://schemas.openxmlformats.org/spreadsheetml/2006/main',
  a: 'http://schemas.openxmlformats.org/drawingml/2006/main',
  p: 'http://schemas.openxmlformats.org/presentationml/2006/main',
};
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const rels = (list) => `${XML}<Relationships xmlns="${NS.pr}">${list.map(([id, type, target]) => `<Relationship Id="${id}" Type="${REL}/${type}" Target="${target}"/>`).join('')}</Relationships>`;
const types = (overrides) => `${XML}<Types xmlns="${NS.ct}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>${overrides.map(([part, type]) => `<Override PartName="${part}" ContentType="${type}"/>`).join('')}</Types>`;
const core = (title) => `${XML}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>${x(title)}</dc:title></cp:coreProperties>`;
const CORE_TYPE = 'application/vnd.openxmlformats-package.core-properties+xml';
const CORE_REL = ['rIdCore', '../package/2006/relationships/metadata/core-properties', 'docProps/core.xml'];

/** A .docx from text. Lines starting with "# " become bold headings; blank lines separate paragraphs. */
export function makeDocx(text, { title } = {}) {
  const paras = text.replace(/\r/g, '').split('\n').map((line) => {
    if (!line.trim()) return '<w:p/>';
    const heading = line.startsWith('# ');
    const t = heading ? line.slice(2) : line;
    return `<w:p><w:r>${heading ? '<w:rPr><w:b/><w:sz w:val="28"/></w:rPr>' : ''}<w:t xml:space="preserve">${x(t)}</w:t></w:r></w:p>`;
  }).join('');
  return writeZip({
    '[Content_Types].xml': types([['/word/document.xml', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml'], ...(title ? [['/docProps/core.xml', CORE_TYPE]] : [])]),
    '_rels/.rels': rels([['rId1', 'officeDocument', 'word/document.xml'], ...(title ? [[CORE_REL[0], 'metadata/core-properties', CORE_REL[2]]] : [])]).replace(`${REL}/metadata/core-properties`, 'http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties'),
    'word/document.xml': `${XML}<w:document xmlns:w="${NS.w}"><w:body>${paras}<w:sectPr/></w:body></w:document>`,
    ...(title ? { 'docProps/core.xml': core(title) } : {}),
  });
}

const colName = (i) => { let s = ''; i++; while (i) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; };

/** An .xlsx with one sheet from rows (arrays of strings). Numbers stay numbers. */
export function makeXlsx(rows, { sheet = 'Sheet1' } = {}) {
  const body = rows.map((row, r) => `<row r="${r + 1}">${row.map((v, c) => {
    const ref = `${colName(c)}${r + 1}`;
    const s = String(v ?? '');
    if (s === '') return '';
    return /^-?\d+(\.\d+)?$/.test(s) && s.length < 15 ? `<c r="${ref}"><v>${s}</v></c>` : `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${x(s)}</t></is></c>`;
  }).join('')}</row>`).join('');
  const name = sheet.replace(/[\\/?*[\]:]/g, ' ').slice(0, 31);
  return writeZip({
    '[Content_Types].xml': types([
      ['/xl/workbook.xml', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml'],
      ['/xl/worksheets/sheet1.xml', 'application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml'],
      ['/xl/styles.xml', 'application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml'],
    ]),
    '_rels/.rels': rels([['rId1', 'officeDocument', 'xl/workbook.xml']]),
    'xl/workbook.xml': `${XML}<workbook xmlns="${NS.s}" xmlns:r="${NS.r}"><sheets><sheet name="${x(name)}" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    'xl/_rels/workbook.xml.rels': rels([['rId1', 'worksheet', 'worksheets/sheet1.xml'], ['rId2', 'styles', 'styles.xml']]),
    'xl/styles.xml': `${XML}<styleSheet xmlns="${NS.s}"><fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/></cellXfs></styleSheet>`,
    'xl/worksheets/sheet1.xml': `${XML}<worksheet xmlns="${NS.s}"><sheetData>${body}</sheetData></worksheet>`,
  });
}

const THEME = `${XML}<a:theme xmlns:a="${NS.a}" name="Plain"><a:themeElements><a:clrScheme name="Plain"><a:dk1><a:srgbClr val="000000"/></a:dk1><a:lt1><a:srgbClr val="FFFFFF"/></a:lt1><a:dk2><a:srgbClr val="1F2A2E"/></a:dk2><a:lt2><a:srgbClr val="EEEEEE"/></a:lt2><a:accent1><a:srgbClr val="2F5D50"/></a:accent1><a:accent2><a:srgbClr val="A86400"/></a:accent2><a:accent3><a:srgbClr val="5C6770"/></a:accent3><a:accent4><a:srgbClr val="2E7D4F"/></a:accent4><a:accent5><a:srgbClr val="B3261E"/></a:accent5><a:accent6><a:srgbClr val="6B6860"/></a:accent6><a:hlink><a:srgbClr val="0563C1"/></a:hlink><a:folHlink><a:srgbClr val="954F72"/></a:folHlink></a:clrScheme><a:fontScheme name="Plain"><a:majorFont><a:latin typeface="Calibri"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont><a:minorFont><a:latin typeface="Calibri"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont></a:fontScheme><a:fmtScheme name="Plain"><a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst><a:lnStyleLst><a:ln w="9525"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="19050"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="28575"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln></a:lnStyleLst><a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst><a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst></a:fmtScheme></a:themeElements></a:theme>`;
const EMPTY_TREE = '<p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/></p:spTree></p:cSld>';
const PNS = `xmlns:a="${NS.a}" xmlns:r="${NS.r}" xmlns:p="${NS.p}"`;

function textBox(id, name, [x0, y0, cx, cy], paras, size) {
  const ps = paras.map((t) => `<a:p><a:r><a:rPr lang="en-GB" sz="${size}"/><a:t>${x(t)}</a:t></a:r></a:p>`).join('') || '<a:p/>';
  return `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${name}"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="${x0}" y="${y0}"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr><p:txBody><a:bodyPr wrap="square"/><a:lstStyle/>${ps}</p:txBody></p:sp>`;
}

/** A .pptx from slides: [{ title, bullets: [] }]. */
export function makePptx(slides, { title } = {}) {
  const files = {
    '[Content_Types].xml': types([
      ['/ppt/presentation.xml', 'application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml'],
      ['/ppt/slideMasters/slideMaster1.xml', 'application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml'],
      ['/ppt/slideLayouts/slideLayout1.xml', 'application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml'],
      ['/ppt/theme/theme1.xml', 'application/vnd.openxmlformats-officedocument.theme+xml'],
      ...slides.map((_, i) => [`/ppt/slides/slide${i + 1}.xml`, 'application/vnd.openxmlformats-officedocument.presentationml.slide+xml']),
      ...(title ? [['/docProps/core.xml', CORE_TYPE]] : []),
    ]),
    '_rels/.rels': rels([['rId1', 'officeDocument', 'ppt/presentation.xml']]) + '',
    'ppt/presentation.xml': `${XML}<p:presentation ${PNS}><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst><p:sldIdLst>${slides.map((_, i) => `<p:sldId id="${256 + i}" r:id="rId${i + 3}"/>`).join('')}</p:sldIdLst><p:sldSz cx="9144000" cy="5143500"/><p:notesSz cx="6858000" cy="9144000"/></p:presentation>`,
    'ppt/_rels/presentation.xml.rels': rels([['rId1', 'slideMaster', 'slideMasters/slideMaster1.xml'], ['rId2', 'theme', 'theme/theme1.xml'], ...slides.map((_, i) => [`rId${i + 3}`, 'slide', `slides/slide${i + 1}.xml`])]),
    'ppt/slideMasters/slideMaster1.xml': `${XML}<p:sldMaster ${PNS}>${EMPTY_TREE.replace('<p:cSld>', '<p:cSld><p:bg><p:bgPr><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill><a:effectLst/></p:bgPr></p:bg>')}<p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/><p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst></p:sldMaster>`,
    'ppt/slideMasters/_rels/slideMaster1.xml.rels': rels([['rId1', 'slideLayout', '../slideLayouts/slideLayout1.xml'], ['rId2', 'theme', '../theme/theme1.xml']]),
    'ppt/slideLayouts/slideLayout1.xml': `${XML}<p:sldLayout ${PNS} type="blank">${EMPTY_TREE}<p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>`,
    'ppt/slideLayouts/_rels/slideLayout1.xml.rels': rels([['rId1', 'slideMaster', '../slideMasters/slideMaster1.xml']]),
    'ppt/theme/theme1.xml': THEME,
  };
  slides.forEach((s, i) => {
    const tree = `<p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>${textBox(2, 'Title', [457200, 300000, 8229600, 700000], [s.title], 2800)}${textBox(3, 'Body', [457200, 1100000, 8229600, 3800000], s.bullets.map((b) => `• ${b}`), 1600)}</p:spTree></p:cSld>`;
    files[`ppt/slides/slide${i + 1}.xml`] = `${XML}<p:sld ${PNS}>${tree}<p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`;
    files[`ppt/slides/_rels/slide${i + 1}.xml.rels`] = rels([['rId1', 'slideLayout', '../slideLayouts/slideLayout1.xml']]);
  });
  if (title) {
    files['docProps/core.xml'] = core(title);
    files['_rels/.rels'] = `${XML}<Relationships xmlns="${NS.pr}"><Relationship Id="rId1" Type="${REL}/officeDocument" Target="ppt/presentation.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>`;
  }
  return writeZip(files);
}

/** Parse the example source format for decks: slides separated by "---", first line = title, "- " bullets. */
export function parseDeck(md) {
  return md.replace(/\r/g, '').split(/\n---\n/).map((block) => {
    const lines = block.split('\n').map((l) => l.trim()).filter(Boolean);
    return { title: (lines[0] ?? '').replace(/^#+\s*/, ''), bullets: lines.slice(1).map((l) => l.replace(/^[-*]\s*/, '')) };
  }).filter((s) => s.title || s.bullets.length);
}
