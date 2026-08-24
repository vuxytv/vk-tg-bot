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
    return res.status(200).send(data.secret);
  }

  // Новый пост на стене
  if (data && data.type === 'wall_post_new') {
    console.log('=== НОВЫЙ ПОСТ ===');
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
  const VK_TOKEN = process.env.VK_TOKEN;

  if (!TG_TOKEN || !TG_CHAT_ID) {
    console.error('❌ Нет TG_TOKEN или TG_CHAT_ID');
    return;
  }

  const text = post.text || '';
  const postId = post.id;
  const ownerId = post.owner_id;
  const postUrl = `https://vk.com/wall${ownerId}_${postId}`;
  const attachments = post.attachments || [];

  console.log('Вложений:', attachments.length);

  if (attachments.length > 0) {
    const attachment = attachments[0];
    console.log('Тип вложения:', attachment.type);

    // === VK CLIP (вертикальное короткое видео) ===
    if (attachment.type === 'clip') {
      const clip = attachment.clip;
      console.log('Клип ID:', clip.id, 'Owner:', clip.owner_id);

      // Получаем прямую ссылку на видео-файл через VK API
      const videoFileUrl = await getClipFileUrl(clip.owner_id, clip.id, VK_TOKEN);

      if (videoFileUrl) {
        console.log('✅ Получена прямая ссылка на MP4');
        const caption = `${clip.description || ''}\n\n📎 Пост: ${postUrl}`.trim();
        
        // Отправляем как НАТИВНОЕ видео в Telegram
        const response = await fetch(
          `https://api.telegram.org/bot${TG_TOKEN}/sendVideo`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chat_id: TG_CHAT_ID,
              video: videoFileUrl,
              caption: caption.substring(0, 1024),
              supports_streaming: true,
              width: clip.width || 720,
              height: clip.height || 1280,
              duration: clip.duration || 8,
            }),
          }
        );
        const result = await response.json();
        console.log('Telegram sendVideo:', JSON.stringify(result));
        
        if (result.ok) return;
        console.log('⚠️ sendVideo не сработал, пробуем запасной вариант');
      } else {
        console.log('⚠️ Не удалось получить прямую ссылку на файл клипа');
      }

      // Запасной вариант — отправляем как фото-превью со ссылкой
      const previewUrl = clip.first_frame?.[clip.first_frame.length - 1]?.url;
      if (previewUrl) {
        const caption = `🎬 ${clip.title || 'VK Клип'}\n${clip.description || ''}\n\n📎 Клип: https://vk.com/clip${clip.owner_id}_${clip.id}\n📎 Пост: ${postUrl}`.trim();
        const fallbackResponse = await fetch(
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
        console.log('Fallback (фото со ссылкой):', JSON.stringify(await fallbackResponse.json()));
      }
      return;
    }

    // === ФОТО ===
    if (attachment.type === 'photo') {
      const photo = attachment.photo;
      if (photo?.sizes?.length > 0) {
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
  }

  // Обычный текст
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
  console.log('Текст:', JSON.stringify(await response.json()));
}

// Получает прямую ссылку на MP4-файл клипа через VK API
async function getClipFileUrl(ownerId, videoId, vkToken) {
  if (!vkToken) {
    console.error('❌ VK_TOKEN не задан');
    return null;
  }

  try {
    const apiUrl = `https://api.vk.com/method/video.get?v=5.199&videos=${ownerId}_${videoId}&access_token=${vkToken}`;
    console.log('Запрос к VK API video.get...');
    
    const response = await fetch(apiUrl);
    const data = await response.json();

    if (!data.response || !data.response.items || data.response.items.length === 0) {
      console.log('VK API не вернул данные о видео:', JSON.stringify(data));
      return null;
    }

    const video = data.response.items[0];
    const files = video.files || {};
    
    console.log('Доступные качества:', Object.keys(files));
    
    // Берём лучшее качество (720p обычно достаточно для клипа)
    const fileUrl = files.mp4_720 || files.mp4_480 || files.mp4_360 || files.mp4_240 || files.mp4_144;
    
    if (!fileUrl) {
      console.log('Нет прямых ссылок на MP4 в ответе VK API');
      return null;
    }
    
    return fileUrl;
  } catch (error) {
    console.error('Ошибка VK API:', error);
    return null;
  }
}
