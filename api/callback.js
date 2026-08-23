export default async function handler(req, res) {
  // Подтверждение сервера для ВК
  if (req.method === 'GET') {
    return res.status(200).send('VK → TG bot is running');
  }

  if (req.method !== 'POST') {
    return res.status(405).send('Method not allowed');
  }

  const data = req.body;

  // ВК присылает событие "confirmation" при подключении
  if (data.type === 'confirmation') {
    return res.status(200).send(process.env.VK_CONFIRM);
  }

  // ВК присылает событие "wall_post_new" при новом посте
  if (data.type === 'wall_post_new') {
    const post = data.object;
    await sendPostToTelegram(post);
  }

  return res.status(200).send('ok');
}

async function sendPostToTelegram(post) {
  const text = post.text || '';
  const postId = post.id;
  const ownerId = post.owner_id;
  const postUrl = `https://vk.com/wall${ownerId}_${postId}`;

  const caption = text ? `${text}\n\n📎 Оригинал: ${postUrl}` : `📎 ${postUrl}`;
  const attachments = post.attachments || [];

  // Ищем фото в посте
  const photos = attachments
    .filter(a => a.type === 'photo')
    .map(a => a.photo);

  if (photos.length > 0) {
    // Берём самый большой размер первого фото
    const bestPhoto = photos[0].sizes.reduce((max, size) =>
      size.width * size.height > max.width * max.height ? size : max
    );

    try {
      const response = await fetch(
        `https://api.telegram.org/bot${process.env.TG_TOKEN}/sendPhoto`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: process.env.TG_CHAT_ID,
            photo: bestPhoto.url,
            caption: caption.substring(0, 1024),
          }),
        }
      );
      return await response.json();
    } catch (error) {
      console.error('Ошибка отправки фото:', error);
    }
  }

  // Если фото нет или ошибка — отправляем текстом
  try {
    const response = await fetch(
      `https://api.telegram.org/bot${process.env.TG_TOKEN}/sendMessage`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: process.env.TG_CHAT_ID,
          text: caption.substring(0, 4096),
          disable_web_page_preview: false,
        }),
      }
    );
    return await response.json();
  } catch (error) {
    console.error('Ошибка отправки текста:', error);
  }
}
