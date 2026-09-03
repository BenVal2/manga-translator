chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'OCR') {
    handleOCR(msg.imageDataUrl, msg.apikey)
      .then(sendResponse)
      .catch((e) => sendResponse({ ok: false, error: String(e) }));
    return true;
  }
  if (msg.type === 'OCR_URL') {
    handleOCRUrl(msg.url, msg.apikey, msg.imgW, msg.imgH)
      .then(sendResponse)
      .catch((e) => sendResponse({ ok: false, error: String(e) }));
    return true;
  }
  if (msg.type === 'TRANSLATE') {
    handleTranslate(msg.text, msg.targetLang, msg.apikey)
      .then(sendResponse)
      .catch((e) => sendResponse({ ok: false, error: String(e) }));
    return true;
  }
});

async function handleOCRUrl(url, apikey, imgW, imgH) {
  const form = new FormData();
  form.append('apikey', apikey);
  form.append('url', url);
  form.append('language', 'eng');
  form.append('isOverlayRequired', 'true');
  form.append('OCREngine', '2');
  form.append('detectOrientation', 'true');

  const res = await fetch('https://api.ocr.space/parse/image', {
    method: 'POST',
    body: form
  });
  return parseOCRResponse(await res.json(), imgW, imgH);
}

function parseOCRResponse(data, imgW, imgH) {
  if (data.IsErroredOnProcessing || !data.ParsedResults || !data.ParsedResults.length) {
    return { ok: false, error: data.ErrorMessage || data.Error?.[0]?.message || 'Error de OCR' };
  }
  const parsed = data.ParsedResults[0];
  const text = parsed.ParsedText || '';
  const regions = [];
  const ov = parsed.TextOverlay;
  let ovW = ov && ov.Width ? ov.Width : 0;
  let ovH = ov && ov.Height ? ov.Height : 0;
  if ((!ovW || !ovH) && imgW && imgH) {
    ovW = imgW;
    ovH = imgH;
  }
  console.log('[MangaTranslator BG] OCR result:', {
    textLen: text.length,
    ovW, ovH,
    imgW, imgH,
    linesCount: ov && ov.Lines ? ov.Lines.length : 0,
    sample: text.slice(0, 200)
  });
  if (ov && ov.Lines) {
    for (const line of ov.Lines) {
      const words = line.Words || [];
      if (!words.length) continue;
      let minL = Infinity, minT = Infinity, maxR = 0, maxB = 0;
      const wordTexts = [];
      for (const w of words) {
        if (w.Left === undefined) continue;
        minL = Math.min(minL, w.Left);
        minT = Math.min(minT, w.Top);
        maxR = Math.max(maxR, w.Left + w.Width);
        maxB = Math.max(maxB, w.Top + w.Height);
        wordTexts.push(w.WordText || '');
      }
      if (minL === Infinity) continue;
      const regionText = wordTexts.join(' ').trim();
      if (!regionText) continue;
      regions.push({
        left: ovW > 0 ? (minL / ovW) * 100 : 0,
        top: ovH > 0 ? (minT / ovH) * 100 : 0,
        width: ovW > 0 ? ((maxR - minL) / ovW) * 100 : 50,
        height: ovH > 0 ? ((maxB - minT) / ovH) * 100 : 10,
        text: regionText,
        raw: [minL, minT, maxR, maxB]
      });
    }
  }
  return { ok: true, text, regions };
}

async function handleOCR(imageDataUrl, apikey) {
  const base64 = imageDataUrl.split(',')[1];
  const form = new FormData();
  form.append('apikey', apikey);
  form.append('language', 'eng');
  form.append('isOverlayRequired', 'false');
  form.append('OCREngine', '2');
  form.append('scale', 'true');
  form.append('detectOrientation', 'true');
  form.append('file', new Blob([base64ToBytes(base64)], { type: 'image/png' }), 'manga.png');

  const res = await fetch('https://api.ocr.space/parse/image', {
    method: 'POST',
    body: form
  });
  const data = await res.json();

  if (data.IsErroredOnProcessing || !data.ParsedResults || !data.ParsedResults.length) {
    return { ok: false, error: data.ErrorMessage || 'Error de OCR' };
  }

  const parsed = data.ParsedResults[0];
  const text = parsed.ParsedText || '';

  let words = [];
  if (parsed.TextOverlay && parsed.TextOverlay.Lines) {
    for (const line of parsed.TextOverlay.Lines) {
      const lw = line.Words || [];
      for (const w of lw) {
        if (w.WordText && w.Left !== undefined) {
          words.push({
            text: w.WordText,
            left: (w.Left / parsed.FileParseExitCode) * 100,
            top: (w.Top / parsed.FileParseExitCode) * 100,
            width: (w.Width / parsed.FileParseExitCode) * 100,
            height: (w.Height / parsed.FileParseExitCode) * 100
          });
        }
      }
    }
  }

  return { ok: true, text, words };
}

function base64ToBytes(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

async function handleTranslate(text, targetLang, apikey) {
  const res = await fetch('https://api-free.deepl.com/v2/translate', {
    method: 'POST',
    headers: {
      'Authorization': `DeepL-Auth-Key ${apikey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      text: [text],
      target_lang: targetLang
    })
  });

  if (!res.ok) {
    const errBody = await res.text();
    return { ok: false, error: `DeepL error ${res.status}: ${errBody}` };
  }

  const data = await res.json();
  const translated = data.translations && data.translations.length
    ? data.translations[0].text
    : '';
  return { ok: true, text: translated };
}
