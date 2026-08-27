import json
import os
from http.server import BaseHTTPRequestHandler

import requests
import yt_dlp

TG_TOKEN = os.environ.get("TG_TOKEN")
TG_CHAT_ID = os.environ.get("TG_CHAT_ID")


class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        self._respond(200, "VK -> TG bot is running")

    def do_POST(self):
        try:
            length = int(self.headers.get("Content-Length", 0))
            body = self.rfile.read(length)
            data = json.loads(body)
        except Exception as e:
            print("Ошибка парсинга:", e)
            self._respond(200, "ok")
            return

        # Подтверждение сервера для ВК
        if data.get("type") == "confirmation":
            self._respond(200, data.get("secret", ""))
            return

        # Новый пост на стене
        if data.get("type") == "wall_post_new":
            print("=== НОВЫЙ ПОСТ ===")
            try:
                send_post_to_telegram(data.get("object", {}))
            except Exception as e:
                print("Ошибка обработки поста:", e)

        self._respond(200, "ok")

    def _respond(self, code, text):
        payload = text.encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "text/plain; charset=utf-8")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)


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
        print("Тип вложения:", attachment.get("type"))

        # === VK CLIP ===
        if attachment.get("type") == "clip":
            clip = attachment.get("clip", {})
            clip_url = f"https://vk.com/clip{clip.get('owner_id')}_{clip.get('id')}"
            print("Клип URL:", clip_url)

            video_url, duration, width, height = extract_clip_url(clip_url)

            caption = (clip.get("description") or "").strip()
            caption = f"{caption}\n\n📎 Пост: {post_url}" if caption else f"📎 Пост: {post_url}"

            if video_url:
                # Вариант 1: Telegram сам скачивает по прямой ссылке
                if send_video_url(video_url, caption[:1024], duration, width, height):
                    print("✅ КЛИП ОТПРАВЛЕН КАК НАТИВНОЕ ВИДЕО (по ссылке)")
                    return
                # Вариант 2: скачиваем и отправляем файлом
                video_bytes = download_bytes(video_url)
                if video_bytes and send_video_bytes(video_bytes, caption[:1024], duration, width, height):
                    print("✅ КЛИП ОТПРАВЛЕН КАК НАТИВНОЕ ВИДЕО (файлом)")
                    return

            # Фолбэк — превью со ссылкой
            print("⚠️ Фолбэк: превью со ссылкой")
            frames = clip.get("first_frame") or clip.get("image") or []
            if frames:
                preview = frames[-1].get("url")
                fb_caption = f"🎬 {clip.get('title', 'VK Клип')}\n{clip.get('description', '')}\n\n📎 Клип: {clip_url}\n📎 Пост: {post_url}".strip()
                send_photo(preview, fb_caption[:1024])
            return

        # === ФОТО ===
        if attachment.get("type") == "photo":
            sizes = attachment.get("photo", {}).get("sizes", [])
            if sizes:
                best = max(sizes, key=lambda s: s.get("width", 0) * s.get("height", 0))
                send_photo(best.get("url"), f"{text}\n\n📎 {post_url}".strip()[:1024])
                return

    # Обычный текст
    send_text((f"{text}\n\n📎 {post_url}".strip() or f"📎 {post_url}")[:4096])


def extract_clip_url(clip_url):
    """Получаем прямую MP4-ссылку через yt-dlp."""
    try:
        ydl_opts = {"format": "best[ext=mp4]/best", "quiet": True, "no_warnings": True}
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(clip_url, download=False)

        duration = info.get("duration") or 8
        width = info.get("width") or 720
        height = info.get("height") or 1280

        video_url = info.get("url")
        if not video_url and info.get("formats"):
            mp4s = [f for f in info["formats"] if f.get("ext") == "mp4" and f.get("url")]
            if mp4s:
                video_url = max(mp4s, key=lambda f: f.get("height") or 0).get("url")

        if video_url:
            print("✅ yt-dlp нашёл прямую MP4-ссылку")
        else:
            print("⚠️ yt-dlp не нашёл MP4-ссылку")
        return video_url, duration, width, height
    except Exception as e:
        print("Ошибка yt-dlp:", e)
        return None, 8, 720, 1280


def download_bytes(url):
    try:
        r = requests.get(url, timeout=20)
        if r.status_code == 200:
            print("✅ Скачано байт:", len(r.content))
            return r.content
        print("Ошибка скачивания:", r.status_code)
    except Exception as e:
        print("Ошибка скачивания:", e)
    return None


def send_video_url(video_url, caption, duration, width, height):
    try:
        r = requests.post(
            f"https://api.telegram.org/bot{TG_TOKEN}/sendVideo",
            json={
                "chat_id": TG_CHAT_ID,
                "video": video_url,
                "caption": caption,
                "supports_streaming": True,
                "duration": duration,
                "width": width,
                "height": height,
            },
            timeout=30,
        )
        res = r.json()
        print("sendVideo (url):", json.dumps(res, ensure_ascii=False)[:200])
        return res.get("ok", False)
    except Exception as e:
        print("Ошибка sendVideo (url):", e)
        return False


def send_video_bytes(video_bytes, caption, duration, width, height):
    try:
        r = requests.post(
            f"https://api.telegram.org/bot{TG_TOKEN}/sendVideo",
            data={
                "chat_id": TG_CHAT_ID,
                "caption": caption,
                "supports_streaming": "true",
                "duration": str(duration),
                "width": str(width),
                "height": str(height),
            },
            files={"video": ("video.mp4", video_bytes, "video/mp4")},
            timeout=30,
        )
        res = r.json()
        print("sendVideo (file):", json.dumps(res, ensure_ascii=False)[:200])
        return res.get("ok", False)
    except Exception as e:
        print("Ошибка sendVideo (file):", e)
        return False


def send_photo(photo_url, caption):
    try:
        r = requests.post(
            f"https://api.telegram.org/bot{TG_TOKEN}/sendPhoto",
            json={"chat_id": TG_CHAT_ID, "photo": photo_url, "caption": caption},
            timeout=20,
        )
        print("sendPhoto:", r.json().get("ok"))
    except Exception as e:
        print("Ошибка sendPhoto:", e)


def send_text(text):
    try:
        r = requests.post(
            f"https://api.telegram.org/bot{TG_TOKEN}/sendMessage",
            json={"chat_id": TG_CHAT_ID, "text": text},
            timeout=20,
        )
        print("sendMessage:", r.json().get("ok"))
    except Exception as e:
        print("Ошибка sendMessage:", e)
