/**
 * 小工具模块：压缩图片 / PDF 转 Word / 一键抠图 / 抖音无水印
 *
 * 全部基于成熟库实现：
 *  - 压缩图片：sharp（mozjpeg 压缩 / webp 保透明 / 限宽缩放）
 *  - PDF 转 Word：pdfjs-dist 提取文本 + docx 生成 Word（纯文本型 PDF，扫描件不支持）
 *  - 一键抠图：@imgly/background-removal-node（本地 ONNX 模型推理，首次自动下载权重）
 *  - 抖音无水印：解析分享短链 → 取无水印播放地址（代理下载）
 *
 * 文件上传走 multer 内存存储（单文件上限 25MB）。
 */
import express from 'express';
import multer from 'multer';
import { Readable } from 'node:stream';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
const UA_MOBILE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';

const wrap = (fn) => (req, res) => fn(req, res).catch(e => {
  console.error('[tools]', e.message);
  if (!res.headersSent) res.status(500).json({ error: e.message || '工具执行失败' });
});

/** 二进制文件响应（带原始大小等诊断头） */
function sendFile(res, buf, mime, filename, headers = {}) {
  res.set({
    'Content-Type': mime,
    'Content-Length': buf.length,
    'Content-Disposition': `attachment; filename="download"; filename*=UTF-8''${encodeURIComponent(filename)}`,
    ...headers
  });
  res.send(buf);
}

/* ---------------- 1. 压缩图片（sharp） ---------------- */

router.post('/compress', upload.single('file'), wrap(async (req, res) => {
  if (!req.file) throw new Error('请选择图片文件');
  const quality = Math.min(Math.max(parseInt(req.body.quality) || 80, 10), 95);
  const maxWidth = parseInt(req.body.maxWidth) || 0;

  const sharp = (await import('sharp')).default;
  const buf = req.file.buffer;
  let img = sharp(buf).rotate();                       // 按 EXIF 自动摆正
  const meta = await img.metadata();

  if (maxWidth > 0 && (meta.width || 0) > maxWidth) {
    img = img.resize({ width: maxWidth, withoutEnlargement: true });
  }
  // 有透明通道的输出 webp（保透明），否则输出 mozjpeg（压缩率最佳）
  const hasAlpha = !!meta.hasAlpha;
  const outBuf = hasAlpha
    ? await img.webp({ quality }).toBuffer()
    : await img.jpeg({ quality, mozjpeg: true }).toBuffer();

  sendFile(res, outBuf, hasAlpha ? 'image/webp' : 'image/jpeg', `compressed.${hasAlpha ? 'webp' : 'jpg'}`, {
    'X-Original-Size': String(buf.length),
    'X-Compressed-Size': String(outBuf.length),
    'X-Output-Format': hasAlpha ? 'webp' : 'jpeg'
  });
}));

/* ---------------- 2. PDF 转 Word（pdfjs-dist + docx） ---------------- */

const MAX_PDF_PAGES = 300;

router.post('/pdf2word', upload.single('file'), wrap(async (req, res) => {
  if (!req.file) throw new Error('请选择 PDF 文件');
  if (req.file.mimetype && !/pdf/.test(req.file.mimetype) && !/\.pdf$/i.test(req.file.originalname || '')) {
    throw new Error('仅支持 PDF 文件');
  }

  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const { Document, Packer, Paragraph, TextRun } = await import('docx');

  const pdf = await pdfjs.getDocument({
    data: new Uint8Array(req.file.buffer),
    useSystemFonts: false,
    isEvalSupported: false,
    disableFontFace: true
  }).promise;
  if (pdf.numPages > MAX_PDF_PAGES) throw new Error(`暂不支持超过 ${MAX_PDF_PAGES} 页的 PDF（当前 ${pdf.numPages} 页）`);

  // 逐页提取文本：按 y 坐标聚行，行间距突变视作分段
  const pageParagraphs = [];
  let textLen = 0;
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const tc = await page.getTextContent();
    const items = tc.items.filter(i => i.str && i.str.trim());
    const lines = [];
    for (const it of items) {
      const y = Math.round(it.transform[5]);
      const line = lines.length ? lines[lines.length - 1] : null;
      if (line && Math.abs(line.y - y) <= 3) { line.parts.push(it); }
      else lines.push({ y, parts: [it] });
    }
    lines.sort((a, b) => b.y - a.y);                   // PDF 的 y 自下而上
    let prevY = null;
    for (const ln of lines) {
      ln.parts.sort((a, b) => a.transform[4] - b.transform[4]);
      const text = ln.parts.map(i => i.str).join('').replace(/\s+/g, ' ').trim();
      if (!text) continue;
      // 行距超过行高 2 倍时插入空行分段
      if (prevY !== null && prevY - ln.y > 26 && pageParagraphs.length) {
        pageParagraphs.push(new Paragraph({ children: [] }));
      }
      pageParagraphs.push(new Paragraph({ children: [new TextRun({ text, size: 22 })] }));
      textLen += text.length;
      prevY = ln.y;
    }
    if (p < pdf.numPages) pageParagraphs.push(new Paragraph({ children: [] }));
  }
  if (!textLen) throw new Error('未能从该 PDF 提取到文本（扫描件/纯图片 PDF 不支持）');

  const doc = new Document({
    sections: [{
      children: pageParagraphs.length ? pageParagraphs : [new Paragraph({ children: [] })]
    }]
  });
  const outBuf = await Packer.toBuffer(doc);
  const base = (req.file.originalname || 'document.pdf').replace(/\.pdf$/i, '');
  sendFile(res, Buffer.from(outBuf), 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', `${base}.docx`, {
    'X-Pages': String(pdf.numPages),
    'X-Text-Length': String(textLen)
  });
}));

/* ---------------- 3. 一键抠图（@imgly/background-removal-node，本地模型） ---------------- */

let removeBgChain = Promise.resolve();   // 模型推理吃 CPU，串行执行

router.post('/removebg', upload.single('file'), wrap(async (req, res) => {
  if (!req.file) throw new Error('请选择图片文件');
  const sharp = (await import('sharp')).default;

  // 统一转 png（控尺寸：长边 2048，模型输入推理更稳、内存可控）
  const norm = await sharp(req.file.buffer).rotate()
    .resize({ width: 2048, height: 2048, fit: 'inside', withoutEnlargement: true })
    .png().toBuffer();

  const { removeBackground } = await import('@imgly/background-removal-node');
  const outBlob = await new Promise((resolve, reject) => {
    removeBgChain = removeBgChain.then(async () => {
      try {
        resolve(await removeBackground(new Blob([norm], { type: 'image/png' }), {
          model: 'medium',
          output: { format: 'image/png', quality: 0.9 }
        }));
      } catch (e) { reject(e); }
    }, () => {});
  });

  const outBuf = Buffer.from(await outBlob.arrayBuffer());
  const base = (req.file.originalname || 'image').replace(/\.[^.]+$/, '');
  sendFile(res, outBuf, 'image/png', `${base}_抠图.png`, { 'X-Original-Size': String(req.file.size) });
}));

/* ---------------- 4. 抖音无水印（解析分享链接） ---------------- */

/** 归一化粘贴的分享文本：提取 URL，只裁尾部标点（文案含 emoji/中文不影响） */
function extractUrl(text) {
  const m = String(text || '').match(/https?:\/\/[^\s"'，。]+/);
  if (!m) throw new Error('未识别到链接，请粘贴抖音分享的完整文本或链接');
  return m[0].replace(/[.,!?。，！？]+$/, '');
}

// ttwid：分享页必需 cookie（注册一次缓存复用，有效期 1 年）
let ttwidCache = { value: '', at: 0 };
async function getTtwid() {
  if (ttwidCache.value && Date.now() - ttwidCache.at < 30 * 24 * 3600 * 1000) return ttwidCache.value;
  const r = await fetch('https://ttwid.bytedance.com/ttwid/union/register/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      region: 'cn', aid: 1768, needFid: false, service: 'www.ixigua.com',
      migrate_info: { ticket: '', source: 'node' }, cbUrlProtocol: 'https', union: true
    })
  });
  const cookie = r.headers.getSetCookie().find(c => c.startsWith('ttwid='));
  if (!cookie) throw new Error('ttwid 注册失败');
  // set-cookie 自带 "ttwid=" 前缀，只存值
  ttwidCache = { value: cookie.split(';')[0].slice('ttwid='.length), at: Date.now() };
  return ttwidCache.value;
}

/** 从分享链接/文案解析视频 id（支持短链、PC 链接、图集帖） */
async function resolveVideoId(shareUrl) {
  const res = await fetch(shareUrl, {
    redirect: 'follow',
    headers: { 'User-Agent': UA_MOBILE }
  });
  res.body?.cancel().catch(() => {});
  const finalUrl = res.url || '';
  const m = finalUrl.match(/\/share\/video\/(\d+)/) || finalUrl.match(/\/share\/note\/(\d+)/)
    || finalUrl.match(/\/video\/(\d+)/) || finalUrl.match(/[?&](?:item_id|modal_id)=(\d+)/);
  if (m) return m[1];
  const tail = finalUrl.split('?')[0].match(/(\d+)\/?$/);
  if (tail) return tail[1];
  throw new Error('未能从该链接解析出视频 id（请确认是抖音分享链接）');
}

router.post('/douyin', wrap(async (req, res) => {
  const shareUrl = extractUrl(req.body?.url);
  const id = await resolveVideoId(shareUrl);
  const ttwid = await getTtwid();

  // 分享页 _ROUTER_DATA（手机 UA + ttwid 必需）
  const r = await fetch(`https://www.iesdouyin.com/share/video/${id}/`, {
    headers: { 'User-Agent': UA_MOBILE, Cookie: `ttwid=${ttwid}` }
  });
  const html = await r.text();
  const m = html.match(/window\._ROUTER_DATA\s*=\s*(\{.*?\})\s*<\/script>/s);
  if (!m) throw new Error('解析失败：分享页数据缺失（抖音可能已调整页面结构）');
  const data = JSON.parse(m[1]);
  const pages = data?.loaderData || {};
  // 键名形如 "video_(id)/page" / "note_(id)/page"，其中 "(id)" 是字面量而非真实视频 id
  const key = Object.keys(pages).find(k => /\(id\)\/page$/.test(k));
  const item = pages?.[key]?.videoInfoRes?.item_list?.[0];
  if (!item) throw new Error('解析失败：未取到视频信息（可稍后重试）');

  const video = item.video || {};
  const uri = video.play_addr?.uri || '';
  if (!uri) throw new Error('解析失败：未取到播放地址');
  res.json({
    id,
    title: item.desc || '',
    author: item.author?.nickname || '',
    duration: video.duration || 0,
    cover: video.cover?.url_list?.[0] || video.origin_cover?.url_list?.[0] || '',
    // 签名 CDN 地址有时效，只下发拼好的播放入口，代理层实时跟随
    playUrl: `https://www.douyin.com/aweme/v1/play/?video_id=${uri}&ratio=1080p`
  });
}));

/** 视频代理：无水印地址带下载头转发（支持 Range，供 <video> 预览与保存） */
router.get('/douyin/file', wrap(async (req, res) => {
  const u = String(req.query.u || '');
  if (!/^https?:\/\//.test(u) || !/douyin/.test(u)) throw new Error('参数不合法');
  const headers = { 'User-Agent': UA_MOBILE };
  if (req.headers.range) headers.Range = req.headers.range;
  const upstream = await fetch(u, { headers, redirect: 'follow' });
  if (!upstream.ok && upstream.status !== 206) throw new Error(`源站返回 ${upstream.status}`);

  res.status(upstream.status);
  const pass = ['content-type', 'content-length', 'content-range', 'accept-ranges'];
  for (const h of pass) { const v = upstream.headers.get(h); if (v) res.set(h, v); }
  res.set('Content-Type', upstream.headers.get('content-type') || 'video/mp4');
  if (req.query.download) {
    res.set('Content-Disposition', `attachment; filename="douyin.mp4"; filename*=UTF-8''${encodeURIComponent('抖音无水印.mp4')}`);
  }
  Readable.fromWeb(upstream.body).pipe(res);
}));

export default router;
