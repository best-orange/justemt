"""把 public/ 下的 hero 壁纸重新编码成 WebP，并同时生成一份压缩后的 JPEG 兜底。

背景：桌面版 hero.jpg 原始 6336x3564 / 6.46 MB，hero-light.jpg 5760x3240 / 3.97 MB。
作为一张铺满屏幕的背景图，这个分辨率远超任何显示设备所需，首屏代价极大。

策略：
  - 桌面：缩到 2560px 宽（覆盖到 2560 宽视口原生显示，4K 下轻微放大可接受）
  - 移动：缩到 1280px 宽（覆盖 428pt 宽手机 @3x = 1284px）
  - 输出 WebP（主）+ 重压缩 JPEG（兜底），CSS 侧用 image-set() 选择
  - 只降分辨率与重新编码，不做锐化/调色等会改变观感的处理

用法：
  python compress-hero.py --dry-run     # 只报告，不写文件
  python compress-hero.py               # 实际生成
"""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

from PIL import Image

PROJECT_ROOT = Path(__file__).resolve().parents[1]
PUBLIC = PROJECT_ROOT / "public"

# name -> (目标宽度, 说明)
TARGETS: dict[str, tuple[int, str]] = {
    "hero.jpg": (2560, "暗色桌面"),
    "hero-light.jpg": (2560, "亮色桌面"),
    "hero-light-mobile.jpg": (1280, "亮色移动"),
    "hero-dark-mobile.jpg": (1280, "暗色移动"),
}

WEBP_QUALITY = 80
WEBP_METHOD = 6
JPEG_QUALITY = 82


def kb(path: Path) -> float:
    return path.stat().st_size / 1024


def fit(image: Image.Image, target_width: int) -> Image.Image:
    """按目标宽度等比缩放；本来就比目标小的图不放大，避免无意义的重采样。"""
    if image.width <= target_width:
        return image
    height = round(image.height * target_width / image.width)
    return image.resize((target_width, height), Image.LANCZOS)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true", help="只报告，不写文件")
    args = parser.parse_args()

    rows: list[tuple[str, str, str, str, str]] = []
    failed = False

    for name, (target_width, label) in TARGETS.items():
        src = PUBLIC / name
        if not src.exists():
            print(f"[skip] {name} 不存在", file=sys.stderr)
            failed = True
            continue

        before_kb = kb(src)
        with Image.open(src) as opened:
            original_size = opened.size
            image = opened.convert("RGB")
            resized = fit(image, target_width)

            if args.dry_run:
                rows.append((
                    label,
                    f"{original_size[0]}x{original_size[1]}",
                    f"{resized.width}x{resized.height}",
                    f"{before_kb:.0f} KB",
                    "dry-run",
                ))
                continue

            webp_path = src.with_suffix(".webp")
            resized.save(webp_path, "WEBP", quality=WEBP_QUALITY, method=WEBP_METHOD)

            # 兜底 JPEG 原地覆盖，保持 CSS 里的 /hero.jpg 这类引用依然有效
            resized.save(src, "JPEG", quality=JPEG_QUALITY, optimize=True, progressive=True)

        rows.append((
            label,
            f"{original_size[0]}x{original_size[1]}",
            f"{resized.width}x{resized.height}",
            f"{before_kb:.0f} KB",
            f"{kb(webp_path):.0f} KB webp / {kb(src):.0f} KB jpg",
        ))

    print(f"{'用途':<10} {'原始':<12} {'输出':<12} {'原始体积':<10} {'结果'}")
    print("-" * 74)
    for row in rows:
        print(f"{row[0]:<10} {row[1]:<12} {row[2]:<12} {row[3]:<10} {row[4]}")

    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
