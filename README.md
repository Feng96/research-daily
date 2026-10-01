# 科研日历

适用于 GitHub Pages 的纯静态页面。公开访问者只能浏览；维护者通过仓库提交更新内容。页面没有账号、数据库或写入接口。本机与 ISAAC 自动采集尚未配置。

## 文件

- `index.html`：页面结构
- `styles.css`：样式
- `script.js`：日历和记录展示
- `research-data.json`：已获准公开的四条记录
- `.nojekyll`：让 GitHub Pages 直接提供静态文件

## 添加记录

只把确认可公开的内容写入 `research-data.json`。它是 JSON 数组，每条记录使用以下字段：

```json
[
  {
    "id": "2026-10-01-example",
    "date": "2026-10-01",
    "title": "已获准公开的标题",
    "summary": "已获准公开的简要进度。",
    "category": "可选分类",
    "status": "可选状态",
    "note": "可选的日期或核实说明。",
    "sources": []
  }
]
```

`date` 必须是 `YYYY-MM-DD` 格式的真实日期；`title` 和 `summary` 必填。`id` 应保持稳定且唯一；`status`、`note`、`details` 与 `category` 可省略。`sources` 当前均为空数组。页面按日期降序显示，直接使用原始日期字符串，不进行时区转换。文字作为纯文本呈现，不解析 HTML。当前来源覆盖不完整，空白日期不代表当天没有科研活动。

用本地静态 HTTP 服务预览，例如在此目录运行 `python -m http.server 8000`，再访问 `http://localhost:8000/`。直接双击打开 HTML 文件时，浏览器通常会阻止读取 JSON，页面会显示读取失败提示。

待公开范围确认后，由仓库管理员提交文件并在仓库设置中启用 GitHub Pages。修改网页内容仍需拥有仓库写入权限。

