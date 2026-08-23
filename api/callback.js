export default async function handler(req, res) {
  // GET-запрос — проверка что сервер работает
  if (req.method === 'GET') {
    res.setHeader('Content-Type', 'text/plain');
    return res.status(200).send('VK → TG bot is running');
  }

  if (req.method !== 'POST') {
    return res.status(405).send('Method not allowed');
  }

  const data = req.body;

  // Подтверждение сервера для ВК
  // ВК ждёт РОВНО ту строку, что показана в настройках Callback API
  if (data.type === 'confirmation') {
    res.setHeader('Content-Type', 'text/plain');
    return res.status(200).send(process.env.VK_CONFIRM);
  }

  // Новый пост на стене
  if (data.type === 'wall_post_new') {
    try {
      const post = data.object;
      await sendPostToTelegram(post);
    } catch (error) {
      console.error('Ошибка обработки поста:', error);
    }
  }

  // ВК требует ответ "ok" на любое событие
  res.setHeader('Content-Type', 'text/plain');
  return res.status(200).send('ok');
}

async function sendPostToTelegram(post) {
  const TG_TOKEN = process.env.TG_TOKEN;
  const TG_CHAT_ID = process.env.TG_CHAT_ID;

  const text = post.text || '';
  const postId = post.id;
  const ownerId = post.owner_id;
  const postUrl = `https://vk.com/wall${ownerId}_${postId}`;

  const caption = text
    ? `${text}\n\n📎 Оригинал: ${postUrl}`
    : `📎 ${postUrl}`;

  const attachments = post.attachments || [];

  // Ищем фото среди вложений
  const photos = attachments
    .filter(a => a.type === 'photo')
    .map(a => a.photo);

  // Если есть фото — отправляем как фото с подписью
  if (photos.length > 0) {
    const bestPhoto = photos[0].sizes.reduce((max, size) =>
      size.width * size.height > max.width * max.height ? size : max
    );

    const photoResult = await fetch(
      `https://api.telegram.org/bot${TG_TOKEN}/sendPhoto`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: TG_CHAT_ID,
          photo: bestPhoto.url,
          caption: caption.substring(0, 1024),
        }),
      }
    );

    const photoData = await photoResult.json();
    console.log('Результат отправки фото:', JSON.stringify(photoData));

    if (photoData.ok) return;
  }

  // Если фото нет или ошибка — отправляем текстом
  const textResult = await fetch(
    `https://api.telegram.org/bot${TG_TOKEN}/sendMessage`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: TG_CHAT_ID,
        text: caption.substring(0, 4096),
        disable_web_page_preview: false,
      }),
    }
  );

  const textData = await textResult.json();
  console.log('Результат отправки текста:', JSON.stringify(textData));
}
