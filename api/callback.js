export default async function handler(req, res) {
  console.log('=== ЗАПРОС ОТ ВК ===');
  console.log('Method:', req.method);

  if (req.method === 'GET') {
    return res.status(200).send('VK → TG bot is running');
  }

  if (req.method !== 'POST') {
    return res.status(405).send('Method not allowed');
  }

  const data = req.body;

  // Подтверждение сервера
  if (data && data.type === 'confirmation') {
    console.log('Подтверждение:', data.secret);
    return res.status(200).send(data.secret);
  }

  // Новый пост на стене
  if (data && data.type === 'wall_post_new') {
    console.log('=== ПОЛУЧЕН НОВЫЙ ПОСТ ===');
    try {
      await sendPostToTelegram(data.object);
    } catch (error) {
      console.error('Ошибка:', error);
    }
  }

  return res.status(200).send('ok');
}

async function sendPostToTelegram(post) {
  const TG_TOKEN = process.env.TG_TOKEN;
  const TG_CHAT_ID = process.env.TG_CHAT_ID;

  // Проверка переменных
  if (!TG_TOKEN) {
    console.error('❌ ОШИБКА: TG_TOKEN не задан в переменных окружения Vercel');
    return;
  }
  if (!TG_CHAT_ID) {
    console.error('❌ ОШИБКА: TG_CHAT_ID не задан в переменных окружения Vercel');
    return;
  }

  const text = post.text || '';
  const postId = post.id;
  const ownerId = post.owner_id;
  const postUrl = `https://vk.com/wall${ownerId}_${postId}`;

  const attachments = post.attachments || [];
  
  console.log('Тип поста: текст =', text.length > 0, ', вложений =', attachments.length);
  
  // Анализируем тип вложения
  if (attachments.length > 0) {
    const attachment = attachments[0];
    console.log('Тип вложения:', attachment.type);

    // КЛИП (вертикальное видео)
    if (attachment.type === 'clip') {
      const clip = attachment.clip;
      const clipUrl = `https://vk.com/clip${clip.owner_id}_${clip.id}`;
      const caption = `${clip.title || 'VK Клип'}\n${clip.description || ''}\n\n🎬 Клип: ${clipUrl}\n📎 Пост: ${postUrl}`.trim();
      
      // Пытаемся отправить превью + ссылку
      const previewUrl = clip.first_frame?.[clip.first_frame.length - 1]?.url 
                       || clip.image?.[clip.image.length - 1]?.url;
      
      if (previewUrl) {
        const photoResult = await fetch(
          `https://api.telegram.org/bot${TG_TOKEN}/sendPhoto`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chat_id: TG_CHAT_ID,
              photo: previewUrl,
              caption: caption.substring(0, 1024),
            }),
          }
        );
        const result = await photoResult.json();
        console.log('Клип отправлен как фото со ссылкой:', JSON.stringify(result));
        if (result.ok) return;
      }
      
      // Фолбэк — просто текстом
      const textResult = await fetch(
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
      console.log('Клип отправлен текстом:', JSON.stringify(await textResult.json()));
      return;
    }

    // ФОТО
    if (attachment.type === 'photo') {
      const photo = attachment.photo;
      if (photo && photo.sizes && photo.sizes.length > 0) {
        const bestPhoto = photo.sizes.reduce((max, size) =>
          size.width * size.height > max.width * max.height ? size : max
        );
        
        const caption = `${text}\n\n📎 ${postUrl}`.trim();
        
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
        console.log('Фото:', JSON.stringify(await response.json()));
        return;
      }
    }

    // ВИДЕО (обычное, не клип)
    if (attachment.type === 'video') {
      const video = attachment.video;
      const videoUrl = `https://vk.com/video${video.owner_id}_${video.id}`;
      const caption = `${text}\n\n🎬 Видео: ${videoUrl}\n📎 Пост: ${postUrl}`.trim();
      
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
      console.log('Видео:', JSON.stringify(await response.json()));
      return;
    }
  }

  // Обычный текст без вложений
  const caption = `${text}\n\n📎 ${postUrl}`.trim() || `📎 ${postUrl}`;
  
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
  console.log('Текст:', JSON.stringify(result));
}
