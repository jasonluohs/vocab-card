// Mock OpenAI-compatible upstream for local end-to-end testing.
import http from 'node:http';

const PORT = 9911;

const server = http.createServer((req, res) => {
  if (req.method === 'POST' && req.url === '/chat/completions') {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const parsed = JSON.parse(body);
      const userMsg = parsed.messages?.[1]?.content ?? '';
      // Vision/OCR request: content is an array with an image_url part.
      if (Array.isArray(userMsg) && userMsg.some((p) => p.type === 'image_url')) {
        res.setHeader('content-type', 'application/json');
        res.end(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    text: 'The investigation sought to elucidate the hidden mechanism. Serendipity guided the discovery.',
                  }),
                },
              },
            ],
          }),
        );
        return;
      }
      const term =
        (typeof userMsg === 'string' ? userMsg : '').match(/Word\/phrase: (.+)/)?.[1] ??
        'unknown';
      const card = {
        term,
        primaryChinese: `（测试）${term} 的中文释义`,
        primaryEnglish: `A mock definition of "${term}".`,
        exampleSentence: `This is a mock sentence using ${term}.`,
        additionalSenses: [
          { chinese: `（测试）${term} 其他词义`, english: `Another mock sense of ${term}.` },
        ],
      };
      res.setHeader('content-type', 'application/json');
      res.end(
        JSON.stringify({
          choices: [{ message: { content: JSON.stringify(card) } }],
        }),
      );
    });
    return;
  }
  res.statusCode = 404;
  res.end('{}');
});

server.listen(PORT, () => console.log(`mock upstream on :${PORT}`));
