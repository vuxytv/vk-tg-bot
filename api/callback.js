export default async function handler(req, res) {
  // Логируем всё, что приходит — для отладки
  console.log('=== ЗАПРОС ОТ ВК ===');
  console.log('Method:', req.method);
  console.log('Body:', JSON.stringify(req.body));

  // GET-запрос (проверка в браузере)
  if (req.method === 'GET') {
    return res.status(200).send('VK → TG bot is running');
  }

  if (req.method !== 'POST') {
    return res.status(405).send('Method not allowed');
  }

  const data = req.body;

  // Подтверждение сервера
  if (data && data.type === 'confirmation') {
    const confirmString = process.env.VK_CONFIRM;
    console.log('Отправляем подтверждение:', confirmString);
    return res.status(200).send(confirmString);
  }

  // Новый пост на стене
  if (data && data.type === 'wall_post_new') {
    console.log('Получен новый пост');
    try {
      await sendPostToTelegram(data.object);
    } catch (error) {
      console.error('Ошибка при отправке:', error);
    }
  }

  // ВК требует ответ "ok"
  return res.status(200).send('ok');
}

async function sendPostToTelegram(post) {
  const TG_TOKEN = process.env.TG_TOKEN;
  const TG_CHAT_ID = process.env.TG_CHAT_ID;

  if (!TG_TOKEN || !TG_CHAT_ID) {
    console.error('Нет токена или ID чата');
    return;
  }

  const text = post.text || '';
  const postId = post.id;
  const ownerId = post.owner_id;
  const postUrl = `https://vk.com/wall${ownerId}_${postId}`;

  const caption = text
    ? `${text}\n\n📎 Оригинал: ${postUrl}`
    : `📎 ${postUrl}`;

  const attachments = post.attachments || [];
  const photos = attachments
    .filter(a => a.type === 'photo')
    .map(a => a.photo)
    .filter(p => p && p.sizes);

  // Если есть фото — отправляем как фото
  if (photos.length > 0) {
    const bestPhoto = photos[0].sizes.reduce((max, size) =>
      size.width * size.height > max.width * max.height ? size : max
    );

    try {
      const response = await fetch(
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
      const result = await response.json();
      console.log('Telegram response (photo):', JSON.stringify(result));
      if (result.ok) return;
    } catch (error) {
      console.error('Ошибка отправки фото:', error);
    }
  }

  // Иначе отправляем текстом
  try {
    const response = await fetch(
      `https://api.telegram.org/bot${TG_TOKEN}/sendMessage`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: TG_CHAT_ID,
          text: caption.substring(0, 4096),
        }),
      }
    );
    const result = await response.json();
    console.log('Telegram response (text):', JSON.stringify(result));
  } catch (error) {
    console.error('Ошибка отправки текста:', error);
  }
}
