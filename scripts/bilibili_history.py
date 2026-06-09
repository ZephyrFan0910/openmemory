#!/usr/bin/env python3
"""
B站观看历史导出脚本
用法：python scripts/bilibili_history.py [输出文件路径]

获取 Cookie 方法：
1. 浏览器打开 https://www.bilibili.com/account/history
2. F12 → Application → Cookies → 找到 SESSDATA 的值
3. 粘贴到下方 COOKIES 中
"""

import requests
import csv
import time
import sys
import os

# ========== 配置 ==========
COOKIES = {
    "SESSDATA": "",  # 从浏览器 F12 获取，必填
}

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Referer": "https://www.bilibili.com",
}

OUTPUT_FILE = sys.argv[1] if len(sys.argv) > 1 else "bilibili_history.csv"
MAX_PAGES = 200  # 最多抓取页数
PAGE_DELAY = 1.0  # 每页间隔秒数（防风控）
# ============================


def get_cookie_from_browser():
    """尝试从常见浏览器路径读取 Cookie"""
    # 用户可以手动填入，这里只是提示
    print("请手动获取 SESSDATA Cookie：")
    print("1. 浏览器打开 https://www.bilibili.com/account/history")
    print("2. F12 → Application → Cookies → 找到 SESSDATA 的值")
    print("3. 填入脚本的 COOKIES 字典中")
    print()
    return None


def fetch_history(max_id=0):
    """获取一页观看历史"""
    url = "https://api.bilibili.com/x/web-interface/history/cursor"
    params = {
        "max": max_id,
        "type": 0,
        "view_at": 0,
    }

    try:
        resp = requests.get(url, params=params, cookies=COOKIES, headers=HEADERS, timeout=10)
        resp.raise_for_status()
        data = resp.json()

        if data.get("code") != 0:
            print(f"API 错误: {data.get('message', '未知错误')}")
            if data.get("code") == -101:
                print("Cookie 无效或已过期，请重新获取 SESSDATA")
            return None

        return data.get("data", {})
    except Exception as e:
        print(f"请求失败: {e}")
        return None


def format_timestamp(ts):
    """Unix 时间戳转可读格式"""
    if not ts:
        return ""
    return time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(ts))


def main():
    # 检查 Cookie
    if not COOKIES.get("SESSDATA"):
        get_cookie_from_browser()
        sys.exit(1)

    print(f"开始获取 B站观看历史...")
    print(f"输出文件: {OUTPUT_FILE}")
    print()

    all_items = []
    max_id = 0

    for page in range(MAX_PAGES):
        data = fetch_history(max_id)
        if not data:
            break

        items = data.get("list", [])
        if not items:
            print(f"第 {page + 1} 页: 无数据，停止")
            break

        for item in items:
            title = item.get("title", "").replace("\n", " ").strip()
            owner = item.get("owner", {})
            author = owner.get("name", "")
            view_at = format_timestamp(item.get("view_at", 0))
            bvid = item.get("bvid", "")
            link = f"https://www.bilibili.com/video/{bvid}" if bvid else ""
            duration = item.get("duration", 0)  # 秒
            progress = item.get("progress", 0)  # 观看进度

            # 分区信息
            tag = item.get("tag", "")

            all_items.append({
                "标题": title,
                "UP主": author,
                "观看时间": view_at,
                "链接": link,
                "时长_秒": duration,
                "进度_秒": progress,
                "BV号": bvid,
            })

        has_more = data.get("has_more", False)
        max_id = data.get("max", 0)

        print(f"第 {page + 1} 页: {len(items)} 条, 累计 {len(all_items)} 条")

        if not has_more or not max_id:
            print("已获取全部历史")
            break

        time.sleep(PAGE_DELAY)

    # 写入 CSV
    if not all_items:
        print("未获取到任何数据")
        return

    with open(OUTPUT_FILE, "w", newline="", encoding="utf-8-sig") as f:
        writer = csv.DictWriter(f, fieldnames=["标题", "UP主", "观看时间", "链接", "时长_秒", "进度_秒", "BV号"])
        writer.writeheader()
        writer.writerows(all_items)

    print(f"\n✅ 导出完成: {len(all_items)} 条记录 → {OUTPUT_FILE}")
    print(f"\n导入 OpenMemory:")
    print(f"  node src/cli.js import video {OUTPUT_FILE} -p bilibili")


if __name__ == "__main__":
    main()
