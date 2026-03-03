const OpenAI = require('openai');

const MAX_IMAGE_DATA_LENGTH = 7 * 1024 * 1024;

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: 'OPENAI_API_KEY not configured' });
    }

    const imageDataUrl = String(req.body?.image_data_url || '');
    if (!imageDataUrl || !imageDataUrl.startsWith('data:image/')) {
      return res.status(400).json({ error: 'Valid image_data_url required' });
    }
    if (imageDataUrl.length > MAX_IMAGE_DATA_LENGTH) {
      return res.status(413).json({ error: 'Image is too large' });
    }

    const openai = new OpenAI({ apiKey });
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      temperature: 0,
      max_tokens: 1200,
      messages: [
        {
          role: 'system',
          content: 'Extract all readable text from the provided image. Return plain text only, preserving line breaks where helpful. If no text exists, return an empty string.',
        },
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Run OCR on this image and return only extracted text.' },
            { type: 'image_url', image_url: { url: imageDataUrl } },
          ],
        },
      ],
    });

    const text = String(completion.choices?.[0]?.message?.content || '').trim();
    return res.status(200).json({ text });
  } catch (err) {
    const msg = err?.message || 'OCR request failed';
    return res.status(500).json({ error: msg });
  }
};
