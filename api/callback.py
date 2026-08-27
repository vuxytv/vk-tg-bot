import json
import os
import requests
from urllib.parse import urlencode
import yt_dlp
from io import BytesIO

VK_TOKEN = os.environ.get("VK_TOKEN")
TG_TOKEN = os.environ.get("TG_TOKEN")
TG_CHAT_ID = os.environ.get("TG_CHAT_ID")

def handler(request):
    # GET — проверка работы
    if request.method == "GET":
        return ("VK → TG bot is running", 200, {"Content-Type": "text/plain"})

    if request.method != "POST":
        return ("Method not allowed", 405, {"Content-Type": "text/plain"})

    # Парсим тело запроса
    try:
        body = request.get_data(as_text=True)
        data = json.loads(body)
    except Exception as e:
        print(f"Ошибка парсинга: {e}")
        return ("ok", 200, {"Content-Type": "text/plain"})

    # Подтверждение сервера
    if data.get("type") == "confirmation":
        return (data.get("secret", ""), 200, {"Content-Type": "text/plain"})

    # Новый пост на стене
    if data.get("type") == "wall_post_new":
        print("=== НОВЫЙ ПОСТ ===")
        try:
            send_post_to_telegram(data.get("object", {}))
        except Exception as e:
            print(f"Ошибка: {e}")

    return ("ok", 200, {"Content-Type": "text/plain"})


def send_post_to_telegram(post):
    if not TG_TOKEN or not TG_CHAT_ID:
        print("❌ Нет TG_TOKEN или TG_CHAT_ID")
        return

    text = post.get("text", "")
    post_id = post.get("id")
    owner_id = post.get("owner_id")
    post_url = f"https://vk.com/wall{owner_id}_{post_id}"
    attachments = post.get("attachments", [])

    if attachments:
        attachment = attachments[0]
        print(f"Тип вложения: {attachment.get('type')}")

        # === VK CLIP ===
        if attachment.get("type") == "clip":
            clip = attachment.get("clip", {})
            clip_url = f"https://vk.com/clip{clip.get('owner_id')}_{clip.get('id')}"
            print(f"Клип URL: {clip_url}")

            # Скачиваем MP4 через yt-dlp прямо в память
            video_bytes, duration, width, height = download_clip(clip_url)

            if video_bytes:
                caption = (clip.get("description") or "").strip()
                if caption:
                    caption += f"\n\n📎 Пост: {post_url}"
                else:
                    caption = f"📎 Пост: {post_url}"

                # Отправляем как нативное видео через multipart
                success = send_video_multipart(
                    video_bytes, caption[:1024], duration, width, height
                )
                if success:
                    print("✅ КЛИП ОТПРАВЛЕН КАК НАТИВНОЕ ВИДЕО!")
                    return
                print("⚠️ Не удалось отправить как видео")
            else:
                print("⚠️ Не удалось скачать клип")

            # Фолбэк — фото со ссылкой
            preview = (clip.get("first_frame") or clip.get("image") or [{}])[-1].get("url")
            if preview:
                caption = f"🎬 {clip.get('title', 'VK Клип')}\n{clip.get('description', '')}\n\n📎 Клип: {clip_url}\n📎 Пост: {post_url}".strip()
                send_photo(preview, caption[:1024])
            return

        # === ФОТО ===
        if attachment.get("type") == "photo":
            photo = attachment.get("photo", {})
            sizes = photo.get("sizes", [])
            if sizes:
                best = max(sizes, key=lambda s: s.get("width", 0) * s.get("height", 0))
                caption = f"{text}\n\n📎 {post_url}".strip()
                send_photo(best.get("url"), caption[:1024])
                return

    # Обычный текст
    caption = f"{text}\n\n📎 {post_url}".strip() or f"📎 {post_url}"
    send_text(caption[:4096])


def download_clip(clip_url):
    """Скачивает клип через yt-dlp прямо в память (bytes)."""
    try:
        ydl_opts = {
            "format": "best[ext=mp4]/best",
            "quiet": True,
            "no_warnings": True,
            "extract_flat": False,
        }

        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(clip_url, download=False)

            # Ищем лучшую MP4-ссылку
            video_url = None
            duration = info.get("duration", 8) or 8
            width = info.get("width", 720) or 720
            height = info.get("height", 1280) or 1280

            if "url" in info:
                video_url = info["url"]
            elif "formats" in info:
                mp4_formats = [
                    f for f in info["formats"]
                    if f.get("ext") == "mp4" and f.get("url")
                ]
                if mp4_formats:
                    best = max(mp4_formats, key=lambda f: f.get("height", 0) or 0)
                    video_url = best["url"]

            if not video_url:
                print("Не найдена MP4-ссылка")
                return None, duration, width, height

            print(f"Скачиваем MP4: {video_url[:80]}...")

            # Скачиваем файл в память
            response = requests.get(video_url, stream=True, timeout=20)
            if response.status_code == 200:
                buf = BytesIO()
                for chunk in response.iter_content(chunk_size=8192):
                    buf.write(chunk)
                buf.seek(0)
                print(f"✅ Скачано {buf.getbuffer().nbytes} байт")
                return buf, duration, width, height
            else:
                print(f"Ошибка скачивания: {response.status_code}")
                return None, duration, width, height

    except Exception as e:
        print(f"Ошибка yt-dlp: {e}")
        return None, 8, 720, 1280


def send_video_multipart(video_bytes, caption, duration, width, height):
    """Отправляет видео в Telegram через multipart/form-data."""
    try:
        url = f"https://api.telegram.org/bot{TG_TOKEN}/sendVideo"
        files = {
            "video": ("video.mp4", video_bytes, "video/mp4")
        }
        data = {
            "chat_id": TG_CHAT_ID,
            "caption": caption,
            "supports_streaming": "true",
            "duration": str(duration),
            "width": str(width),
            "height": str(height),
        }
        response = requests.post(url, files=files, data=data, timeout=30)
        result = response.json()
        print(f"Telegram sendVideo: {json.dumps(result)[:200]}")
        return result.get("ok", False)
    except Exception as e:
        print(f"Ошибка отправки видео: {e}")
        return False


def send_photo(photo_url, caption):
    try:
        url = f"https://api.telegram.org/bot{TG_TOKEN}/sendPhoto"
        response = requests.post(url, json={
            "chat_id": TG_CHAT_ID,
            "photo": photo_url,
            "caption": caption,
        }, timeout=20)
        print(f"Telegram sendPhoto: {response.json()}")
    except Exception as e:
        print(f"Ошибка отправки фото: {e}")


def send_text(text):
    try:
        url = f"https://api.telegram.org/bot{TG_TOKEN}/sendMessage"
        response = requests.post(url, json={
            "chat_id": TG_CHAT_ID,
            "text": text,
        }, timeout=20)
        print(f"Telegram sendText: {response.json()}")
    except Exception as e:
        print(f"Ошибка отправки текста: {e}")
