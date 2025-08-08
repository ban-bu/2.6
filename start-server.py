#!/usr/bin/env python3
"""
简单的HTTP服务器，用于本地开发Vibe Meeting
解决file://协议下WebSocket连接的限制问题
"""

import http.server
import socketserver
import webbrowser
import os
import threading
import time

# 配置
PORT = 8080
DIRECTORY = "."

class CustomHTTPRequestHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=DIRECTORY, **kwargs)
    
    def end_headers(self):
        # 添加CORS头以支持WebSocket连接
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', '*')
        super().end_headers()

def start_frontend_server():
    """启动前端HTTP服务器"""
    print(f"🌐 启动前端服务器在端口 {PORT}...")
    
    with socketserver.TCPServer(("", PORT), CustomHTTPRequestHandler) as httpd:
        print(f"✅ 前端服务器运行在: http://localhost:{PORT}")
        print(f"📱 主页面: http://localhost:{PORT}/index.html")
        print("按 Ctrl+C 停止服务器")
        
        # 3秒后自动打开浏览器
        def open_browser():
            time.sleep(3)
            webbrowser.open(f'http://localhost:{PORT}/index.html')
        
        threading.Thread(target=open_browser, daemon=True).start()
        
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\n🛑 服务器已停止")

if __name__ == "__main__":
    # 检查是否在正确的目录
    if not os.path.exists("index.html"):
        print("❌ 错误：请在包含 index.html 的目录下运行此脚本")
        exit(1)
    
    start_frontend_server()